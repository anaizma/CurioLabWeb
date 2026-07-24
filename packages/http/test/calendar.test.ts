// -------------------------------------------------------------------------
// Shared chapter calendar controllers (guardian/director portal work order,
// Feature 1). Embedded Postgres, synthetic data only; the controllers resolve a
// real AuthContext from a live session token (not an injected ctx).
//
//   - a director creates / edits / cancels a calendar event in THEIR chapter;
//   - the staff GET is audience-filtered (a mentor sees mentor-audience events, a
//     director sees every audience); a canceled event drops out;
//   - the guardian GET returns the child's-chapter parent-audience events;
//   - a null session is an opaque 403; a cross-chapter director is an opaque 403.
// -------------------------------------------------------------------------

import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { createSession } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMembership } from './helpers/fixtures.js'
import { seedDirector, onboardStudent, seedVerifiedGuardian } from './helpers/seed.js'
import {
  createCalendarEvent,
  editCalendarEvent,
  cancelCalendarEvent,
  listStaffCalendar,
  listGuardianCalendar,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

async function sessionFor(accountId: string): Promise<string> {
  const { token } = await createSession(h.sql, {
    accountId,
    expiresAt: new Date(Date.now() + 3_600_000),
  })
  return token
}

/** A mentor account + membership in `chapter` + a live session token. */
async function seedMentor(chapter: string) {
  const mentor = await makeAdult(h.sql)
  await makeMembership(h.sql, mentor, chapter, { role: 'junior_mentor', status: 'active' })
  return { mentor, token: await sessionFor(mentor) }
}

const START = '2099-10-03T14:00:00.000Z'
const END = '2099-10-03T16:00:00.000Z'

function createBody(chapterId: string, audiences: string[], title = 'Saturday Session') {
  return { chapterId, title, kind: 'session', startsAt: START, endsAt: END, audiences }
}

// ===========================================================================
describe('POST/PATCH/DELETE /api/ops/calendar (calendar.manage)', () => {
  test('a director creates an event (201) with precise ISO timestamps', async () => {
    const d = await seedDirector(h.sql)
    const res = await createCalendarEvent({
      sql: h.sql,
      sessionToken: d.directorToken,
      body: createBody(d.chapter, ['parent', 'mentor']),
    })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      chapterId: d.chapter,
      kind: 'session',
      startsAt: START,
      endsAt: END,
      audiences: ['parent', 'mentor'],
    })
  })

  test('edit writes a new revision (200); cancel removes it from the staff read (200)', async () => {
    const d = await seedDirector(h.sql)
    const created = await createCalendarEvent({
      sql: h.sql,
      sessionToken: d.directorToken,
      body: createBody(d.chapter, ['mentor', 'director']),
    })
    const id = created.body.id

    const edited = await editCalendarEvent({
      sql: h.sql,
      sessionToken: d.directorToken,
      params: { id },
      body: { title: 'Renamed' },
    })
    expect(edited.status).toBe(200)
    expect(edited.body).toMatchObject({ id, title: 'Renamed' })

    const canceled = await cancelCalendarEvent({
      sql: h.sql,
      sessionToken: d.directorToken,
      params: { id },
    })
    expect(canceled.status).toBe(200)
    expect(canceled.body).toMatchObject({ id, status: 'canceled' })

    const staff = await listStaffCalendar({
      sql: h.sql,
      sessionToken: d.directorToken,
      query: { chapterId: d.chapter },
    })
    expect(staff.body.items.map((e) => e.id)).not.toContain(id)
  })

  test('a cross-chapter director is an opaque 403; a null session is an opaque 403', async () => {
    const d = await seedDirector(h.sql)
    const other = await makeChapter(h.sql)
    const cross = await createCalendarEvent({
      sql: h.sql,
      sessionToken: d.directorToken,
      body: createBody(other, ['parent']),
    })
    expect(cross.status).toBe(403)

    const noSession = await createCalendarEvent({
      sql: h.sql,
      sessionToken: null,
      body: createBody(d.chapter, ['parent']),
    })
    expect(noSession.status).toBe(403)
  })

  test('a bad audience set / time range is a 400', async () => {
    const d = await seedDirector(h.sql)
    const badAudience = await createCalendarEvent({
      sql: h.sql,
      sessionToken: d.directorToken,
      body: createBody(d.chapter, []),
    })
    expect(badAudience.status).toBe(400)
    const badTime = await createCalendarEvent({
      sql: h.sql,
      sessionToken: d.directorToken,
      body: { ...createBody(d.chapter, ['parent']), startsAt: END, endsAt: START },
    })
    expect(badTime.status).toBe(400)
  })
})

// ===========================================================================
describe('GET /api/ops/calendar (calendar.view, audience-filtered)', () => {
  test('a mentor sees mentor-audience events but NOT director-only; a director sees all', async () => {
    const d = await seedDirector(h.sql)
    const m = await seedMentor(d.chapter)

    const mentorEvent = await createCalendarEvent({
      sql: h.sql,
      sessionToken: d.directorToken,
      body: createBody(d.chapter, ['mentor'], 'Mentor Briefing'),
    })
    const directorOnly = await createCalendarEvent({
      sql: h.sql,
      sessionToken: d.directorToken,
      body: createBody(d.chapter, ['director'], 'Director Only'),
    })

    const mentorView = await listStaffCalendar({
      sql: h.sql,
      sessionToken: m.token,
      query: { chapterId: d.chapter },
    })
    const mentorIds = mentorView.body.items.map((e) => e.id)
    expect(mentorIds).toContain(mentorEvent.body.id)
    expect(mentorIds).not.toContain(directorOnly.body.id)

    const directorView = await listStaffCalendar({
      sql: h.sql,
      sessionToken: d.directorToken,
      query: { chapterId: d.chapter },
    })
    const directorIds = directorView.body.items.map((e) => e.id)
    expect(directorIds).toContain(mentorEvent.body.id)
    expect(directorIds).toContain(directorOnly.body.id)
  })
})

// ===========================================================================
describe('GET /api/guardian/calendar (guardian.view_calendar)', () => {
  test('a verified guardian sees the child’s-chapter parent-audience events only', async () => {
    const student = await onboardStudent(h.sql, { activate: true })
    const g = await seedVerifiedGuardian(h.sql, student)

    const parentEvent = await createCalendarEvent({
      sql: h.sql,
      sessionToken: student.directorToken,
      body: createBody(student.chapter, ['parent', 'mentor'], 'Parent Night'),
    })
    // Staff-only event — must NOT reach the guardian.
    await createCalendarEvent({
      sql: h.sql,
      sessionToken: student.directorToken,
      body: createBody(student.chapter, ['mentor', 'director'], 'Staff Sync'),
    })

    const res = await listGuardianCalendar({ sql: h.sql, sessionToken: g.guardianToken })
    expect(res.status).toBe(200)
    const ids = res.body.items.map((e) => e.id)
    expect(ids).toEqual([parentEvent.body.id])
    expect(res.body.items[0]!.chapterId).toBe(student.chapter)
  })

  test('a session with no verified child is an opaque 403', async () => {
    const stranger = await makeAdult(h.sql)
    const res = await listGuardianCalendar({ sql: h.sql, sessionToken: await sessionFor(stranger) })
    expect(res.status).toBe(403)
  })
})
