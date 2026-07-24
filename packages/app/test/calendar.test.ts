// -------------------------------------------------------------------------
// CalendarService tests (guardian/director portal work order, Feature 1) — the
// shared, audience-scoped chapter calendar. Embedded Postgres, synthetic data
// only, deterministic timestamps.
//
// Under test:
//   - a Chapter Director creates an event in THEIR chapter (calendar.manage);
//     cross-chapter create is an opaque Forbidden with no row written;
//   - endsAt > startsAt is enforced; audiences must be a non-empty valid subset;
//   - PATCH writes a NEW revision (append-only: the prior row is retained, version
//     bumps); DELETE cancels (a tombstone revision; the event drops out of reads
//     but both rows remain);
//   - every create/edit/cancel writes an audit + access_ledger row carrying the
//     audience set;
//   - a GUARDIAN reads only parent-audience active events for their child's
//     chapter, and NOTHING from another chapter; a guardian with no verified child
//     is denied; a guardian with children in two chapters sees both (each tagged);
//   - STAFF read: a mentor sees only mentor-audience events for their chapter and
//     NOT director-only ones; a director sees ALL their chapter's events; a caller
//     not staff of the chapter gets a Forbidden; cross-chapter leakage is impossible.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Forbidden, authorize, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMinor, makeMembership } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import {
  CalendarService,
  CalendarEventNotFoundError,
  CalendarValidationError,
  type CalendarAuthorizeFn,
  type CreateCalendarEventInput,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

function svc(authorizeFn = authorize as unknown as CalendarAuthorizeFn) {
  return new CalendarService({ sql: h.sql, authorize: authorizeFn })
}

function directorCtx(director: string, chapter: string) {
  return baseCtx(director, new Date(), [mem('chapter_director', chapter)])
}
function mentorCtx(mentor: string, chapter: string) {
  return baseCtx(mentor, new Date(), [mem('junior_mentor', chapter)])
}
function guardianCtx(guardian: string, children: string[]) {
  return { ...baseCtx(guardian, new Date()), guardianOf: children }
}

const START = '2099-10-03T14:00:00.000Z'
const END = '2099-10-03T16:00:00.000Z'

function createInput(chapterId: string, o: Partial<CreateCalendarEventInput> = {}): CreateCalendarEventInput {
  return {
    chapterId,
    title: o.title ?? 'Saturday Session',
    kind: o.kind ?? 'session',
    startsAt: o.startsAt ?? START,
    endsAt: o.endsAt ?? END,
    audiences: o.audiences ?? ['parent', 'mentor', 'director'],
    location: o.location,
    notes: o.notes,
  }
}

/** A verified-and-enrolled minor child with an active student membership. */
async function seedChildInChapter(chapter: string): Promise<string> {
  const child = await makeMinor(h.sql)
  await makeMembership(h.sql, child, chapter, { role: 'student', status: 'active' })
  return child
}

async function create(chapter: string, director: string, o: Partial<CreateCalendarEventInput> = {}) {
  const ctx = directorCtx(director, chapter)
  let result!: Awaited<ReturnType<CalendarService['createEvent']>>
  await withRequest(async () => {
    result = await svc().createEvent(createInput(chapter, o), ctx)
  })
  return result
}

// ===========================================================================
describe('CalendarService.createEvent', () => {
  test('a director creates an event in THEIR chapter; the shape carries precise ISO timestamps', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const event = await create(chapter, director, {
      audiences: ['parent', 'mentor'],
      location: 'Room 214',
      notes: 'Bring a laptop',
    })
    expect(event).toMatchObject({
      chapterId: chapter,
      title: 'Saturday Session',
      kind: 'session',
      startsAt: START,
      endsAt: END,
      audiences: ['parent', 'mentor'],
      location: 'Room 214',
      notes: 'Bring a laptop',
      createdByAccountId: director,
    })
    expect(event.id).toBeTruthy()
    expect(typeof event.createdAt).toBe('string')

    // The v1 revision row is persisted.
    const rows = await h.sql`select version, status from calendar_event where event_id = ${event.id}`
    expect(rows).toHaveLength(1)
    expect(rows[0]!.version).toBe(1)
    expect(rows[0]!.status).toBe('active')
  })

  test('create writes an audit + access_ledger row carrying the audience set', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const event = await create(chapter, director, { audiences: ['director'] })

    const audit = await h.sql`
      select detail, chapter_id from audit_entry
      where action = 'calendar.created' and actor_account_id = ${director}
    `
    expect(audit).toHaveLength(1)
    expect(audit[0]!.chapter_id).toBe(chapter)
    expect(audit[0]!.detail).toMatchObject({ eventId: event.id, audiences: ['director'] })

    const ledger = await h.sql`
      select event, chapter_id, detail from access_ledger
      where event = 'calendar.created' and actor_account_id = ${director}
    `
    expect(ledger).toHaveLength(1)
    expect(ledger[0]!.chapter_id).toBe(chapter)
    expect(ledger[0]!.detail).toMatchObject({ eventId: event.id, audiences: ['director'] })
  })

  test('a director of ANOTHER chapter is denied (Forbidden), no event created', async () => {
    const chapter = await makeChapter(h.sql)
    const otherChapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const ctx = directorCtx(director, otherChapter)

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().createEvent(createInput(chapter), ctx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
    const rows = await h.sql`select id from calendar_event where chapter_id = ${chapter}`
    expect(rows).toHaveLength(0)
  })

  test('audiences must be a non-empty valid subset', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const ctx = directorCtx(director, chapter)
    await withRequest(async () => {
      await expect(svc().createEvent(createInput(chapter, { audiences: [] }), ctx)).rejects.toThrow(
        CalendarValidationError,
      )
      await expect(
        svc().createEvent(createInput(chapter, { audiences: ['staff'] as never }), ctx),
      ).rejects.toThrow(CalendarValidationError)
    })
  })

  test('endsAt must be strictly after startsAt', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const ctx = directorCtx(director, chapter)
    await withRequest(async () => {
      await expect(
        svc().createEvent(createInput(chapter, { startsAt: END, endsAt: START }), ctx),
      ).rejects.toThrow(CalendarValidationError)
    })
  })
})

// ===========================================================================
describe('CalendarService.editEvent (append-only new revision)', () => {
  test('an edit writes a NEW revision (version bumps, prior row retained)', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const event = await create(chapter, director, { title: 'Original', audiences: ['parent', 'mentor'] })
    const ctx = directorCtx(director, chapter)

    let edited!: Awaited<ReturnType<CalendarService['editEvent']>>
    await withRequest(async () => {
      edited = await svc().editEvent(event.id, { title: 'Edited', audiences: ['director'] }, ctx)
    })
    expect(edited).toMatchObject({ id: event.id, title: 'Edited', audiences: ['director'] })

    // Both revisions exist (append-only): nothing was destroyed.
    const rows = await h.sql`select version, title from calendar_event where event_id = ${event.id} order by version`
    expect(rows).toHaveLength(2)
    expect(rows[0]!.title).toBe('Original')
    expect(rows[1]!.title).toBe('Edited')
    // The current-state projection shows the latest revision.
    const [cur] = await h.sql`select version, title from calendar_event_current where event_id = ${event.id}`
    expect(cur!.version).toBe(2)
    expect(cur!.title).toBe('Edited')

    // An edit is audited + ledgered with the prior + next audience sets.
    const ledger = await h.sql`
      select detail from access_ledger where event = 'calendar.edited' and actor_account_id = ${director}
    `
    expect(ledger).toHaveLength(1)
    expect(ledger[0]!.detail).toMatchObject({
      eventId: event.id,
      priorAudiences: ['parent', 'mentor'],
      audiences: ['director'],
    })
  })

  test('editing an unknown event is a CalendarEventNotFoundError', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const ctx = directorCtx(director, chapter)
    await withRequest(async () => {
      await expect(svc().editEvent(randomUUID(), { title: 'x' }, ctx)).rejects.toThrow(
        CalendarEventNotFoundError,
      )
    })
  })

  test('a director of another chapter cannot edit (Forbidden), unchanged', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const event = await create(chapter, director, { title: 'Owned' })

    const otherChapter = await makeChapter(h.sql)
    const intruder = await makeAdult(h.sql)
    const intruderCtx = directorCtx(intruder, otherChapter)
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().editEvent(event.id, { title: 'Hijacked' }, intruderCtx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
    const [cur] = await h.sql`select title, version from calendar_event_current where event_id = ${event.id}`
    expect(cur!.title).toBe('Owned')
    expect(cur!.version).toBe(1)
  })
})

// ===========================================================================
describe('CalendarService.cancelEvent (tombstone)', () => {
  test('a cancel writes a canceled tombstone; the event drops from reads, rows remain', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const event = await create(chapter, director, { audiences: ['mentor', 'director'] })
    const ctx = directorCtx(director, chapter)

    let result!: Awaited<ReturnType<CalendarService['cancelEvent']>>
    await withRequest(async () => {
      result = await svc().cancelEvent(event.id, ctx)
    })
    expect(result).toMatchObject({ id: event.id, status: 'canceled', version: 2 })

    // The row + the tombstone both remain (append-only): nothing hard-deleted.
    const rows = await h.sql`select status from calendar_event where event_id = ${event.id} order by version`
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.status)).toEqual(['active', 'canceled'])

    // The event no longer appears in the director's staff read.
    let staff!: Awaited<ReturnType<CalendarService['listStaffCalendar']>>
    await withRequest(async () => {
      staff = await svc().listStaffCalendar(ctx, { chapterId: chapter })
    })
    expect(staff.items.map((e) => e.id)).not.toContain(event.id)

    const ledger = await h.sql`
      select detail from access_ledger where event = 'calendar.canceled' and actor_account_id = ${director}
    `
    expect(ledger).toHaveLength(1)
    expect(ledger[0]!.detail).toMatchObject({ eventId: event.id, audiences: ['mentor', 'director'] })
  })
})

// ===========================================================================
describe('CalendarService.listGuardianCalendar', () => {
  test('returns only parent-audience active events for the child’s chapter, nothing from another', async () => {
    const chapter = await makeChapter(h.sql)
    const otherChapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const otherDirector = await makeAdult(h.sql)
    const child = await seedChildInChapter(chapter)
    const guardian = await makeAdult(h.sql)

    const parentEvent = await create(chapter, director, { title: 'Parent Night', audiences: ['parent', 'mentor'] })
    // Not for parents (mentor/director only) — must NOT appear.
    await create(chapter, director, { title: 'Staff Sync', audiences: ['mentor', 'director'] })
    // Parent event in ANOTHER chapter — must NOT appear (cross-chapter isolation).
    await create(otherChapter, otherDirector, { title: 'Other Parent Night', audiences: ['parent'] })

    let result!: Awaited<ReturnType<CalendarService['listGuardianCalendar']>>
    await withRequest(async () => {
      result = await svc().listGuardianCalendar(guardianCtx(guardian, [child]))
    })
    const ids = result.items.map((e) => e.id)
    expect(ids).toEqual([parentEvent.id])
    expect(result.items[0]!.chapterId).toBe(chapter)
  })

  test('a guardian with no verified child is denied (Forbidden)', async () => {
    const guardian = await makeAdult(h.sql)
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().listGuardianCalendar(guardianCtx(guardian, []))
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
  })

  test('a guardian with children in two chapters sees both, each tagged with its chapterId', async () => {
    const chapterA = await makeChapter(h.sql)
    const chapterB = await makeChapter(h.sql)
    const dirA = await makeAdult(h.sql)
    const dirB = await makeAdult(h.sql)
    const childA = await seedChildInChapter(chapterA)
    const childB = await seedChildInChapter(chapterB)
    const guardian = await makeAdult(h.sql)

    const evA = await create(chapterA, dirA, { audiences: ['parent'] })
    const evB = await create(chapterB, dirB, { audiences: ['parent'] })

    let result!: Awaited<ReturnType<CalendarService['listGuardianCalendar']>>
    await withRequest(async () => {
      result = await svc().listGuardianCalendar(guardianCtx(guardian, [childA, childB]))
    })
    const byId = new Map(result.items.map((e) => [e.id, e.chapterId]))
    expect(byId.get(evA.id)).toBe(chapterA)
    expect(byId.get(evB.id)).toBe(chapterB)
  })
})

// ===========================================================================
describe('CalendarService.listStaffCalendar (audience-filtered)', () => {
  test('a mentor sees only mentor-audience events, NOT director-only ones', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const mentor = await makeAdult(h.sql)

    const mentorEvent = await create(chapter, director, { title: 'Mentor Briefing', audiences: ['mentor'] })
    const bothEvent = await create(chapter, director, { title: 'All hands', audiences: ['parent', 'mentor', 'director'] })
    const directorOnly = await create(chapter, director, { title: 'Director Only', audiences: ['director'] })

    let result!: Awaited<ReturnType<CalendarService['listStaffCalendar']>>
    await withRequest(async () => {
      result = await svc().listStaffCalendar(mentorCtx(mentor, chapter), { chapterId: chapter })
    })
    const ids = result.items.map((e) => e.id)
    expect(ids).toContain(mentorEvent.id)
    expect(ids).toContain(bothEvent.id)
    expect(ids).not.toContain(directorOnly.id)
  })

  test('a director sees ALL their chapter’s events including director-only ones', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const mentorEvent = await create(chapter, director, { audiences: ['mentor'] })
    const directorOnly = await create(chapter, director, { audiences: ['director'] })

    let result!: Awaited<ReturnType<CalendarService['listStaffCalendar']>>
    await withRequest(async () => {
      result = await svc().listStaffCalendar(directorCtx(director, chapter), { chapterId: chapter })
    })
    const ids = result.items.map((e) => e.id)
    expect(ids).toContain(mentorEvent.id)
    expect(ids).toContain(directorOnly.id)
  })

  test('a caller not staff of the requested chapter is denied (Forbidden); no cross-chapter leakage', async () => {
    const chapter = await makeChapter(h.sql)
    const otherChapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    await create(chapter, director, { audiences: ['mentor', 'director'] })

    // A mentor of ANOTHER chapter requests this chapter's calendar.
    const intruder = await makeAdult(h.sql)
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().listStaffCalendar(mentorCtx(intruder, otherChapter), { chapterId: chapter })
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
  })
})
