// -------------------------------------------------------------------------
// AttendanceService tests (guardian/director portal work order, Feature 2) — the
// guardian-submitted, staff-resolved attendance & make-up check-ins. Embedded
// Postgres, synthetic data only, deterministic clock (ctx.now injected; slot
// validation reads calendar instants, never an uncontrollable clock).
//
// Under test:
//   - a guardian submits an ABSENT exception for their OWN verified child with
//     consent + valid slots (after the missed session, before the next) -> scheduled;
//     a slot ON/AFTER the next session is rejected; a slot before the missed one is
//     rejected; absent WITHOUT consent is rejected; absent with NO slot is rejected;
//   - a LATE exception carries arriveAt, has NO make-up (makeup_status NULL);
//   - no next session (last of term) -> slots validated against the term's ends_on;
//   - a session in ANOTHER chapter is refused; a DIFFERENT guardian's child -> 403;
//   - counts: N absents / M completed -> totalAbsences=N, outstanding=N-M, madeUp=M,
//     late counted; a second term counted separately (staff roster termId path);
//   - completeMakeup flips status -> completed (append-only: prior row retained),
//     moves outstanding->madeUp, and is idempotent (re-complete writes no new row);
//   - the staff roster is chapter-scoped + teaching-role-gated, shows display names;
//   - every submission + completion writes an audit + access-ledger row.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Forbidden, authorize, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMinor, makeMembership, makeTerm } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import {
  AttendanceService,
  AttendanceExceptionNotFoundError,
  AttendanceMakeupNotApplicableError,
  AttendanceValidationError,
  type AttendanceAuthorizeFn,
  type SubmitExceptionInput,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

function svc(authorizeFn = authorize as unknown as AttendanceAuthorizeFn) {
  return new AttendanceService({ sql: h.sql, authorize: authorizeFn })
}

// A request instant at which the seeded minor (dob 2015) is comfortably < 18, so a
// guardian WRITE is in force. The sessions live in 2099 (validation reads their
// instants, not `now`), so slot validation is independent of this clock.
const NOW = new Date('2025-01-01T00:00:00.000Z')

const MISSED_START = '2099-10-03T14:00:00.000Z'
const MISSED_END = '2099-10-03T16:00:00.000Z'
const NEXT_START = '2099-10-10T14:00:00.000Z'
const NEXT_END = '2099-10-10T16:00:00.000Z'

function guardianCtx(guardian: string, children: string[]) {
  return { ...baseCtx(guardian, NOW, []), guardianOf: children }
}
function directorCtx(director: string, chapter: string) {
  return baseCtx(director, NOW, [mem('chapter_director', chapter)])
}
function mentorCtx(mentor: string, chapter: string) {
  return baseCtx(mentor, NOW, [mem('junior_mentor', chapter)])
}

/** Insert a calendar_event session revision (Feature 1's shape); return event_id. */
async function seedSession(
  chapter: string,
  startsAt: string,
  endsAt: string,
  createdBy: string,
  kind = 'session',
): Promise<string> {
  const eventId = randomUUID()
  await h.sql`
    insert into calendar_event (
      event_id, chapter_id, version, status, title, kind, starts_at, ends_at,
      audiences, created_by_account_id
    ) values (
      ${eventId}, ${chapter}, 1, 'active', 'Saturday Session', ${kind}, ${startsAt}, ${endsAt},
      ${['parent', 'mentor']}::calendar_audience[], ${createdBy}
    )
  `
  return eventId
}

/** A verified-and-enrolled minor child with an active student membership in chapter. */
async function seedChild(chapter: string): Promise<string> {
  const child = await makeMinor(h.sql, { dateOfBirth: '2015-06-01' })
  await makeMembership(h.sql, child, chapter, { role: 'student', status: 'active' })
  return child
}

function submitInput(sessionEventId: string, o: Partial<SubmitExceptionInput> = {}): SubmitExceptionInput {
  return {
    sessionEventId,
    type: o.type ?? 'absent',
    reason: o.reason,
    arriveAt: o.arriveAt,
    makeupConsent: o.makeupConsent ?? (o.type === 'late' ? undefined : true),
    makeupSlots: o.makeupSlots ?? (o.type === 'late' ? undefined : ['2099-10-05T18:00:00.000Z']),
  }
}

async function submit(child: string, guardian: string, sessionEventId: string, o: Partial<SubmitExceptionInput> = {}) {
  const ctx = guardianCtx(guardian, [child])
  let result!: Awaited<ReturnType<AttendanceService['submitException']>>
  await withRequest(async () => {
    result = await svc().submitException(child, submitInput(sessionEventId, o), ctx)
  })
  return result
}

// ===========================================================================
describe('AttendanceService.submitException — absent + make-up', () => {
  test('absent with consent + valid slots (after missed, before next) lands scheduled', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    await makeTerm(h.sql, chapter)
    const child = await seedChild(chapter)
    const guardian = await makeAdult(h.sql)
    const missed = await seedSession(chapter, MISSED_START, MISSED_END, director)
    await seedSession(chapter, NEXT_START, NEXT_END, director)

    const ex = await submit(child, guardian, missed, {
      reason: 'family trip',
      makeupSlots: ['2099-10-05T18:00:00.000Z', '2099-10-06T18:00:00.000Z'],
    })
    expect(ex).toMatchObject({
      studentAccountId: child,
      sessionEventId: missed,
      type: 'absent',
      reason: 'family trip',
      makeupConsent: true,
      makeupStatus: 'scheduled',
      createdByGuardianAccountId: guardian,
    })
    expect(ex.makeupSlots).toEqual(['2099-10-05T18:00:00.000Z', '2099-10-06T18:00:00.000Z'])
    expect(ex.id).toBeTruthy()

    const rows = await h.sql`select version, makeup_status from attendance_exception where exception_id = ${ex.id}`
    expect(rows).toHaveLength(1)
    expect(rows[0]!.makeup_status).toBe('scheduled')
  })

  test('a slot ON or AFTER the next session is rejected', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    await makeTerm(h.sql, chapter)
    const child = await seedChild(chapter)
    const guardian = await makeAdult(h.sql)
    const missed = await seedSession(chapter, MISSED_START, MISSED_END, director)
    await seedSession(chapter, NEXT_START, NEXT_END, director)

    await withRequest(async () => {
      // exactly ON the next session start.
      await expect(
        svc().submitException(child, submitInput(missed, { makeupSlots: [NEXT_START] }), guardianCtx(guardian, [child])),
      ).rejects.toThrow(AttendanceValidationError)
      // after the next session.
      await expect(
        svc().submitException(child, submitInput(missed, { makeupSlots: ['2099-10-11T18:00:00.000Z'] }), guardianCtx(guardian, [child])),
      ).rejects.toThrow(AttendanceValidationError)
    })
  })

  test('a slot before the missed session is rejected', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    await makeTerm(h.sql, chapter)
    const child = await seedChild(chapter)
    const guardian = await makeAdult(h.sql)
    const missed = await seedSession(chapter, MISSED_START, MISSED_END, director)
    await seedSession(chapter, NEXT_START, NEXT_END, director)

    await withRequest(async () => {
      await expect(
        svc().submitException(child, submitInput(missed, { makeupSlots: ['2099-10-02T18:00:00.000Z'] }), guardianCtx(guardian, [child])),
      ).rejects.toThrow(AttendanceValidationError)
    })
  })

  test('absent WITHOUT consent is rejected', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    await makeTerm(h.sql, chapter)
    const child = await seedChild(chapter)
    const guardian = await makeAdult(h.sql)
    const missed = await seedSession(chapter, MISSED_START, MISSED_END, director)
    await seedSession(chapter, NEXT_START, NEXT_END, director)

    await withRequest(async () => {
      await expect(
        svc().submitException(child, submitInput(missed, { makeupConsent: false }), guardianCtx(guardian, [child])),
      ).rejects.toThrow(AttendanceValidationError)
    })
  })

  test('absent with NO slot is rejected', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    await makeTerm(h.sql, chapter)
    const child = await seedChild(chapter)
    const guardian = await makeAdult(h.sql)
    const missed = await seedSession(chapter, MISSED_START, MISSED_END, director)
    await seedSession(chapter, NEXT_START, NEXT_END, director)

    await withRequest(async () => {
      await expect(
        svc().submitException(child, submitInput(missed, { makeupSlots: [] }), guardianCtx(guardian, [child])),
      ).rejects.toThrow(AttendanceValidationError)
    })
  })

  test('no next session (last of term): slots validated against the term ends_on', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    await makeTerm(h.sql, chapter) // Fall Term 2099: 2099-09-01 .. 2099-12-15
    const child = await seedChild(chapter)
    const guardian = await makeAdult(h.sql)
    const missed = await seedSession(chapter, MISSED_START, MISSED_END, director)
    // No next session seeded.

    // A slot before the term end is fine.
    const ok = await submit(child, guardian, missed, { makeupSlots: ['2099-11-01T18:00:00.000Z'] })
    expect(ok.makeupStatus).toBe('scheduled')

    // A slot AFTER the term end is rejected.
    await withRequest(async () => {
      await expect(
        svc().submitException(child, submitInput(missed, { makeupSlots: ['2099-12-20T18:00:00.000Z'] }), guardianCtx(guardian, [child])),
      ).rejects.toThrow(AttendanceValidationError)
    })
  })
})

// ===========================================================================
describe('AttendanceService.submitException — late', () => {
  test('a late exception carries arriveAt, no make-up, makeup_status NULL', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    await makeTerm(h.sql, chapter)
    const child = await seedChild(chapter)
    const guardian = await makeAdult(h.sql)
    const missed = await seedSession(chapter, MISSED_START, MISSED_END, director)

    const ex = await submit(child, guardian, missed, {
      type: 'late',
      arriveAt: '2099-10-03T14:20:00.000Z',
    })
    expect(ex).toMatchObject({
      type: 'late',
      arriveAt: '2099-10-03T14:20:00.000Z',
      makeupStatus: null,
    })
    expect(ex.makeupSlots).toEqual([])
  })

  test('a late exception without arriveAt is rejected', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    await makeTerm(h.sql, chapter)
    const child = await seedChild(chapter)
    const guardian = await makeAdult(h.sql)
    const missed = await seedSession(chapter, MISSED_START, MISSED_END, director)

    await withRequest(async () => {
      await expect(
        svc().submitException(child, { sessionEventId: missed, type: 'late' }, guardianCtx(guardian, [child])),
      ).rejects.toThrow(AttendanceValidationError)
    })
  })
})

// ===========================================================================
describe('AttendanceService.submitException — scope + guards', () => {
  test('a DIFFERENT guardian (child not in guardianOf) is denied (Forbidden)', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    await makeTerm(h.sql, chapter)
    const child = await seedChild(chapter)
    const stranger = await makeAdult(h.sql)
    const missed = await seedSession(chapter, MISSED_START, MISSED_END, director)

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().submitException(child, submitInput(missed), guardianCtx(stranger, [randomUUID()]))
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
    const rows = await h.sql`select id from attendance_exception where student_account_id = ${child}`
    expect(rows).toHaveLength(0)
  })

  test('a session in ANOTHER chapter is refused', async () => {
    const chapter = await makeChapter(h.sql)
    const otherChapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    await makeTerm(h.sql, chapter)
    const child = await seedChild(chapter)
    const guardian = await makeAdult(h.sql)
    // The session lives in ANOTHER chapter, not the child's.
    const foreignSession = await seedSession(otherChapter, MISSED_START, MISSED_END, director)

    await withRequest(async () => {
      await expect(
        svc().submitException(child, submitInput(foreignSession), guardianCtx(guardian, [child])),
      ).rejects.toThrow(AttendanceValidationError)
    })
  })
})

// ===========================================================================
describe('AttendanceService.viewChildAttendance — counts', () => {
  test('N absents with M completed -> totalAbsences=N, outstanding=N-M, madeUp=M, late counted', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    await makeTerm(h.sql, chapter)
    const child = await seedChild(chapter)
    const guardian = await makeAdult(h.sql)
    const mentor = await makeAdult(h.sql)

    // 3 absents, 1 late, across distinct sessions.
    const s1 = await seedSession(chapter, '2099-10-03T14:00:00Z', '2099-10-03T16:00:00Z', director)
    const s2 = await seedSession(chapter, '2099-10-10T14:00:00Z', '2099-10-10T16:00:00Z', director)
    const s3 = await seedSession(chapter, '2099-10-17T14:00:00Z', '2099-10-17T16:00:00Z', director)
    const s4 = await seedSession(chapter, '2099-10-24T14:00:00Z', '2099-10-24T16:00:00Z', director)
    const ex1 = await submit(child, guardian, s1, { makeupSlots: ['2099-10-05T18:00:00Z'] })
    await submit(child, guardian, s2, { makeupSlots: ['2099-10-12T18:00:00Z'] })
    await submit(child, guardian, s3, { makeupSlots: ['2099-10-19T18:00:00Z'] })
    await submit(child, guardian, s4, { type: 'late', arriveAt: '2099-10-24T14:20:00Z' })

    // Complete one make-up.
    await withRequest(async () => {
      await svc().completeMakeup(ex1.id, directorCtx(mentor, chapter))
    })

    let result!: Awaited<ReturnType<AttendanceService['viewChildAttendance']>>
    await withRequest(async () => {
      result = await svc().viewChildAttendance(child, guardianCtx(guardian, [child]))
    })
    expect(result.counts).toEqual({ totalAbsences: 3, outstanding: 2, madeUp: 1, late: 1 })
    // items include one current row per exception (the completed one shows completed).
    expect(result.items).toHaveLength(4)
    const completed = result.items.find((i) => i.id === ex1.id)
    expect(completed!.makeupStatus).toBe('completed')
  })

  test('a different guardian cannot read another child’s attendance (Forbidden)', async () => {
    const chapter = await makeChapter(h.sql)
    const child = await seedChild(chapter)
    const stranger = await makeAdult(h.sql)
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().viewChildAttendance(child, guardianCtx(stranger, [randomUUID()]))
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
  })
})

// ===========================================================================
describe('AttendanceService.completeMakeup (append-only)', () => {
  test('completes -> completed (prior row retained); idempotent (re-complete no new row)', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    await makeTerm(h.sql, chapter)
    const child = await seedChild(chapter)
    const guardian = await makeAdult(h.sql)
    const missed = await seedSession(chapter, MISSED_START, MISSED_END, director)
    await seedSession(chapter, NEXT_START, NEXT_END, director)
    const ex = await submit(child, guardian, missed)

    let done!: Awaited<ReturnType<AttendanceService['completeMakeup']>>
    await withRequest(async () => {
      done = await svc().completeMakeup(ex.id, directorCtx(director, chapter))
    })
    expect(done).toMatchObject({ id: ex.id, makeupStatus: 'completed' })

    // Append-only: both the scheduled and completed revisions exist.
    const rows = await h.sql`select version, makeup_status from attendance_exception where exception_id = ${ex.id} order by version`
    expect(rows.map((r) => r.makeup_status)).toEqual(['scheduled', 'completed'])

    // Idempotent: completing again writes NO new row.
    await withRequest(async () => {
      await svc().completeMakeup(ex.id, directorCtx(director, chapter))
    })
    const after = await h.sql`select version from attendance_exception where exception_id = ${ex.id}`
    expect(after).toHaveLength(2)
  })

  test('completing an unknown exception is a not-found', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    await withRequest(async () => {
      await expect(svc().completeMakeup(randomUUID(), directorCtx(director, chapter))).rejects.toThrow(
        AttendanceExceptionNotFoundError,
      )
    })
  })

  test('completing a LATE exception is refused (no make-up applies)', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    await makeTerm(h.sql, chapter)
    const child = await seedChild(chapter)
    const guardian = await makeAdult(h.sql)
    const missed = await seedSession(chapter, MISSED_START, MISSED_END, director)
    const ex = await submit(child, guardian, missed, { type: 'late', arriveAt: '2099-10-03T14:20:00Z' })

    await withRequest(async () => {
      await expect(svc().completeMakeup(ex.id, directorCtx(director, chapter))).rejects.toThrow(
        AttendanceMakeupNotApplicableError,
      )
    })
  })

  test('a mentor of ANOTHER chapter cannot complete (Forbidden), unchanged', async () => {
    const chapter = await makeChapter(h.sql)
    const otherChapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    await makeTerm(h.sql, chapter)
    const child = await seedChild(chapter)
    const guardian = await makeAdult(h.sql)
    const missed = await seedSession(chapter, MISSED_START, MISSED_END, director)
    await seedSession(chapter, NEXT_START, NEXT_END, director)
    const ex = await submit(child, guardian, missed)

    const intruder = await makeAdult(h.sql)
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().completeMakeup(ex.id, mentorCtx(intruder, otherChapter))
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
    const rows = await h.sql`select version from attendance_exception where exception_id = ${ex.id}`
    expect(rows).toHaveLength(1)
  })
})

// ===========================================================================
describe('AttendanceService.listStaffAttendance', () => {
  test('by sessionEventId: who is absent/late for that one session, with display names', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    await makeTerm(h.sql, chapter)
    const childA = await seedChild(chapter)
    const childB = await seedChild(chapter)
    const guardian = await makeAdult(h.sql)
    const missed = await seedSession(chapter, MISSED_START, MISSED_END, director)
    await seedSession(chapter, NEXT_START, NEXT_END, director)
    const other = await seedSession(chapter, '2099-11-07T14:00:00Z', '2099-11-07T16:00:00Z', director)
    await submit(childA, guardian, missed)
    await submit(childB, guardian, missed, { type: 'late', arriveAt: '2099-10-03T14:20:00Z' })
    // a different session (last of term) — must NOT appear; slot before the term end.
    await submit(childA, guardian, other, { makeupSlots: ['2099-11-09T18:00:00Z'] })

    let result!: Awaited<ReturnType<AttendanceService['listStaffAttendance']>>
    await withRequest(async () => {
      result = await svc().listStaffAttendance(directorCtx(director, chapter), { sessionEventId: missed })
    })
    expect(result.items).toHaveLength(2)
    const bySession = result.items.every((i) => i.sessionEventId === missed)
    expect(bySession).toBe(true)
    // display names present (first + last initial form, from account.display_name).
    expect(result.items.every((i) => typeof i.displayName === 'string' && i.displayName.length > 0)).toBe(true)
    // the raw last name never leaks.
    expect(result.items.every((i) => !/Testchild/.test(i.displayName))).toBe(true)
  })

  test('by chapterId + termId: a second term is counted separately', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    // term 1: 2099-09-01 .. 2099-12-15 (the fixture default).
    const term1 = await makeTerm(h.sql, chapter)
    // term 2: 2100-01-15 .. 2100-05-15.
    const [t2] = await h.sql`
      insert into term (chapter_id, name, starts_on, ends_on)
      values (${chapter}, 'Spring Term 2100', '2100-01-15', '2100-05-15') returning id
    `
    const term2 = t2!.id as string
    const child = await seedChild(chapter)
    const guardian = await makeAdult(h.sql)

    // 2 absents in term 1, 1 absent in term 2.
    const t1s1 = await seedSession(chapter, '2099-10-03T14:00:00Z', '2099-10-03T16:00:00Z', director)
    const t1s2 = await seedSession(chapter, '2099-10-10T14:00:00Z', '2099-10-10T16:00:00Z', director)
    const t2s1 = await seedSession(chapter, '2100-02-06T14:00:00Z', '2100-02-06T16:00:00Z', director)
    const t2s2 = await seedSession(chapter, '2100-02-13T14:00:00Z', '2100-02-13T16:00:00Z', director)
    await submit(child, guardian, t1s1, { makeupSlots: ['2099-10-05T18:00:00Z'] })
    await submit(child, guardian, t1s2, { makeupSlots: ['2099-10-12T18:00:00Z'] })
    await submit(child, guardian, t2s1, { makeupSlots: ['2100-02-08T18:00:00Z'] })

    let r1!: Awaited<ReturnType<AttendanceService['listStaffAttendance']>>
    let r2!: Awaited<ReturnType<AttendanceService['listStaffAttendance']>>
    await withRequest(async () => {
      r1 = await svc().listStaffAttendance(directorCtx(director, chapter), { chapterId: chapter, termId: term1 })
    })
    await withRequest(async () => {
      r2 = await svc().listStaffAttendance(directorCtx(director, chapter), { chapterId: chapter, termId: term2 })
    })
    void t2s2
    expect(r1.counts).toEqual({ totalAbsences: 2, outstanding: 2, madeUp: 0, late: 0 })
    expect(r2.counts).toEqual({ totalAbsences: 1, outstanding: 1, madeUp: 0, late: 0 })
  })

  test('a non-staff caller is denied (Forbidden); no cross-chapter leak', async () => {
    const chapter = await makeChapter(h.sql)
    const otherChapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    await makeTerm(h.sql, chapter)
    const child = await seedChild(chapter)
    const guardian = await makeAdult(h.sql)
    const missed = await seedSession(chapter, MISSED_START, MISSED_END, director)
    await seedSession(chapter, NEXT_START, NEXT_END, director)
    await submit(child, guardian, missed)

    // A mentor of ANOTHER chapter requests this session's roster.
    const intruder = await makeAdult(h.sql)
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().listStaffAttendance(mentorCtx(intruder, otherChapter), { sessionEventId: missed })
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
  })
})

// ===========================================================================
describe('AttendanceService — audit + access ledger', () => {
  test('a submission writes an audit + access-ledger row; a completion writes another', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    await makeTerm(h.sql, chapter)
    const child = await seedChild(chapter)
    const guardian = await makeAdult(h.sql)
    const missed = await seedSession(chapter, MISSED_START, MISSED_END, director)
    await seedSession(chapter, NEXT_START, NEXT_END, director)
    const ex = await submit(child, guardian, missed)

    const subAudit = await h.sql`
      select detail, chapter_id from audit_entry
      where action = 'attendance.exception_submitted' and actor_account_id = ${guardian}
    `
    expect(subAudit).toHaveLength(1)
    expect(subAudit[0]!.chapter_id).toBe(chapter)
    expect(subAudit[0]!.detail).toMatchObject({ exceptionId: ex.id, sessionEventId: missed, type: 'absent' })

    const subLedger = await h.sql`
      select event, subject_account_id, chapter_id from access_ledger
      where event = 'attendance.exception_submitted' and actor_account_id = ${guardian}
    `
    expect(subLedger).toHaveLength(1)
    expect(subLedger[0]!.subject_account_id).toBe(child)

    await withRequest(async () => {
      await svc().completeMakeup(ex.id, directorCtx(director, chapter))
    })
    const compLedger = await h.sql`
      select detail from access_ledger
      where event = 'attendance.makeup_completed' and actor_account_id = ${director}
    `
    expect(compLedger).toHaveLength(1)
    expect(compLedger[0]!.detail).toMatchObject({ exceptionId: ex.id })
  })
})
