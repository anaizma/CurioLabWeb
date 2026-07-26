import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Forbidden, authorize, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import { ApplicationService } from '../src/index.js'
import { writeApplicationEvent } from '../src/events.js'
import { IllegalTransitionError, InvalidInterviewDateError } from '../src/errors.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

function service(overrides: Record<string, unknown> = {}) {
  return new ApplicationService({ sql: h.sql, authorize, ...overrides })
}

/**
 * A chapter director actor in the given chapter, plus a `submitted` application
 * created directly in a fixture. The public write no longer creates an
 * `application` (that path became `LeadService.createLead`; the `application`
 * row is minted only at 2C submit, part B), so the ops transitions are exercised
 * against an application seeded straight into the table.
 */
async function seed() {
  const chapter = await makeChapter(h.sql)
  const directorId = await makeAdult(h.sql)
  const director = baseCtx(directorId, new Date(), [mem('chapter_director', chapter)])
  const tag = randomUUID().slice(0, 8)
  const applicantName = `Gideon Plumtangle ${tag}`
  const [row] = await h.sql`
    insert into application (
      kind, chapter_id, status, applicant_name, applicant_contact_email,
      guardian_name, guardian_email
    ) values (
      'student', ${chapter}, 'submitted', ${applicantName}, ${`plum.${tag}@example.test`},
      'Guardian Plumtangle', ${`plum.${tag}@example.test`}
    ) returning id
  `
  const applicationId = row!.id as string
  return { chapter, director, applicationId, applicantName }
}

async function statusOf(id: string): Promise<string> {
  const [row] = await h.sql`select status from application where id = ${id}`
  return row!.status as string
}
async function eventCount(id: string): Promise<number> {
  const [row] = await h.sql`select count(*)::int as n from application_event where application_id = ${id}`
  return row!.n as number
}

describe('ops transitions — legal edges write an application_event atomically', () => {
  test('screen: submitted -> screening succeeds and records the event', async () => {
    const { director, applicationId } = await seed()
    const out = await withRequest(() => service().screen(director, { applicationId, note: 'looks strong' }))

    expect(out).toMatchObject({ from: 'submitted', to: 'screening' })
    expect(await statusOf(applicationId)).toBe('screening')

    const [ev] = await h.sql`
      select from_status, to_status, actor_id, note from application_event
      where application_id = ${applicationId}
    `
    expect(ev!.from_status).toBe('submitted')
    expect(ev!.to_status).toBe('screening')
    expect(ev!.actor_id).toBe(director.account.id)
    expect(ev!.note).toBe('looks strong')
  })

  test('the full funnel: screen -> scheduleInterview -> accept, an event per step', async () => {
    const { director, applicationId } = await seed()
    await withRequest(async () => {
      const svc = service()
      await svc.screen(director, { applicationId })
      await svc.scheduleInterview(director, { applicationId })
      await svc.accept(director, { applicationId })
    })
    expect(await statusOf(applicationId)).toBe('accepted')
    expect(await eventCount(applicationId)).toBe(3)
  })

  test('atomicity: a mid-transaction failure rolls back BOTH the status change and the event', async () => {
    const { director, applicationId } = await seed()

    // Inject an event writer that DOES insert the event, then throws — so if the
    // transaction were not atomic, the status change and the event would persist.
    const failingWriter = async (tx: never, e: never) => {
      await writeApplicationEvent(tx, e)
      throw new Error('injected mid-transaction failure')
    }

    let caught: unknown
    await withRequest(async () => {
      try {
        await service({ eventWriter: failingWriter }).screen(director, { applicationId })
      } catch (e) {
        caught = e
      }
    })

    expect(caught).toBeInstanceOf(Error)
    // Neither the status change nor the event survived.
    expect(await statusOf(applicationId)).toBe('submitted')
    expect(await eventCount(applicationId)).toBe(0)
  })
})

describe('ops transitions — illegal edges are rejected before any write', () => {
  test('submitted -> accepted directly is illegal (must pass through screening/interview)', async () => {
    const { director, applicationId } = await seed()
    let caught: unknown
    await withRequest(async () => {
      try {
        await service().accept(director, { applicationId })
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(IllegalTransitionError)
    expect((caught as IllegalTransitionError).reason).toBe('illegal_transition')
    expect(await statusOf(applicationId)).toBe('submitted')
    expect(await eventCount(applicationId)).toBe(0)
  })

  test('any transition out of a terminal state is rejected (withdrawn is terminal)', async () => {
    const { director, applicationId } = await seed()
    await withRequest(() => service().withdraw(director, { applicationId }))
    expect(await statusOf(applicationId)).toBe('withdrawn')

    let caught: unknown
    await withRequest(async () => {
      try {
        await service().screen(director, { applicationId })
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(IllegalTransitionError)
    expect((caught as IllegalTransitionError).reason).toBe('terminal_state')
    // Only the withdraw event exists; the rejected screen wrote nothing.
    expect(await eventCount(applicationId)).toBe(1)
  })
})

// FIX C — scheduleInterview captures a real interview date/time + location on
// the application (nullable columns), in the same transaction as the status flip
// and the event. The fields are optional (a director may schedule the slot
// later); when interviewAt is provided it is validated as a real timestamp.
describe('FIX C — scheduleInterview captures interview_at + interview_location', () => {
  test('stores the provided interviewAt (Date) + interviewLocation and still writes the event', async () => {
    const { director, applicationId } = await seed()
    await withRequest(async () => {
      const svc = service()
      await svc.screen(director, { applicationId })
      const out = await svc.scheduleInterview(director, {
        applicationId,
        interviewAt: new Date('2099-11-15T18:30:00Z'),
        interviewLocation: 'CWRU Sears think[box], Room 3',
      })
      expect(out).toMatchObject({ from: 'screening', to: 'interview_scheduled' })
    })
    const [app] = await h.sql`select status, interview_at, interview_location from application where id = ${applicationId}`
    expect(app!.status).toBe('interview_scheduled')
    expect(new Date(app!.interview_at as string).toISOString()).toBe('2099-11-15T18:30:00.000Z')
    expect(app!.interview_location).toBe('CWRU Sears think[box], Room 3')
    expect(await eventCount(applicationId)).toBe(2) // screen + scheduleInterview
  })

  test('accepts an ISO string for interviewAt', async () => {
    const { director, applicationId } = await seed()
    await withRequest(async () => {
      const svc = service()
      await svc.screen(director, { applicationId })
      await svc.scheduleInterview(director, { applicationId, interviewAt: '2099-12-01T14:00:00Z' })
    })
    const [app] = await h.sql`select interview_at from application where id = ${applicationId}`
    expect(new Date(app!.interview_at as string).toISOString()).toBe('2099-12-01T14:00:00.000Z')
  })

  test('without interview fields the transition still succeeds (columns stay null)', async () => {
    const { director, applicationId } = await seed()
    await withRequest(async () => {
      const svc = service()
      await svc.screen(director, { applicationId })
      await svc.scheduleInterview(director, { applicationId })
    })
    const [app] = await h.sql`select status, interview_at, interview_location from application where id = ${applicationId}`
    expect(app!.status).toBe('interview_scheduled')
    expect(app!.interview_at).toBeNull()
    expect(app!.interview_location).toBeNull()
  })

  test('an invalid interviewAt is rejected before any write (status stays screening)', async () => {
    const { director, applicationId } = await seed()
    let caught: unknown
    await withRequest(async () => {
      const svc = service()
      await svc.screen(director, { applicationId })
      try {
        await svc.scheduleInterview(director, { applicationId, interviewAt: 'not-a-date' })
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(InvalidInterviewDateError)
    const [app] = await h.sql`select status, interview_at from application where id = ${applicationId}`
    expect(app!.status).toBe('screening')
    expect(app!.interview_at).toBeNull()
  })
})

describe('reopen — mints a successor, leaves the declined row immutable', () => {
  test('a declined application reopens into a new submitted successor with reopened_from_id', async () => {
    const { director, applicationId, applicantName } = await seed()
    await withRequest(() => service().decline(director, { applicationId, note: 'not this cohort' }))
    expect(await statusOf(applicationId)).toBe('declined')

    const out = await withRequest(() => service().reopen(director, { applicationId }))
    expect(out.applicationId).not.toBe(applicationId)
    expect(out.reopenedFromId).toBe(applicationId)

    const [succ] = await h.sql`
      select status, reopened_from_id, applicant_name, chapter_id from application where id = ${out.applicationId}
    `
    expect(succ!.status).toBe('submitted')
    expect(succ!.reopened_from_id).toBe(applicationId)
    expect(succ!.applicant_name).toBe(applicantName)

    // The declined row is untouched.
    expect(await statusOf(applicationId)).toBe('declined')
    // A reopen records a creation event on the successor.
    expect(await eventCount(out.applicationId)).toBe(1)
  })

  test('reopen on a non-declined application is illegal', async () => {
    const { director, applicationId } = await seed()
    let caught: unknown
    await withRequest(async () => {
      try {
        await service().reopen(director, { applicationId })
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(IllegalTransitionError)
  })
})

// clearDuplicateFlag (0043) — a director dismissing a non-blocking duplicate
// flag. This is NOT a status transition: it must not touch `status` and must
// not write an `application_event` (that would corrupt the current-status
// "Date" column). Gated on the same `application.transition` capability as
// the other lifecycle actions above.
describe('clearDuplicateFlag — dismiss a duplicate-applicant flag (not a status transition)', () => {
  test('stamps duplicate_cleared_at/by, leaves duplicate_flagged_at + status untouched, writes no event', async () => {
    const { director, applicationId } = await seed()
    const [otherApp] = await h.sql`
      insert into application (
        kind, chapter_id, status, applicant_name, applicant_contact_email,
        guardian_name, guardian_email
      ) values (
        'student', (select chapter_id from application where id = ${applicationId}), 'submitted',
        'Some Other Kid', 'other@example.test', 'Guardian Other', 'other@example.test'
      ) returning id
    `
    await h.sql`
      update application
      set duplicate_flagged_at = now(), duplicate_of_application_id = ${otherApp!.id as string}
      where id = ${applicationId}
    `

    const out = await withRequest(() => service().clearDuplicateFlag(director, { applicationId }))
    expect(out).toMatchObject({ applicationId })

    const [row] = await h.sql`
      select status, duplicate_flagged_at, duplicate_of_application_id, duplicate_cleared_at, duplicate_cleared_by
      from application where id = ${applicationId}
    `
    expect(row!.status).toBe('submitted') // untouched — not a status change
    expect(row!.duplicate_flagged_at).not.toBeNull() // audit trail intact
    expect(row!.duplicate_of_application_id).toBe(otherApp!.id)
    expect(row!.duplicate_cleared_at).not.toBeNull()
    expect(row!.duplicate_cleared_by).toBe(director.account.id)

    // Not a status transition: no application_event written.
    expect(await eventCount(applicationId)).toBe(0)
  })

  test('an unauthorized actor (cross-chapter director) is denied: opaque Forbidden, no mutation', async () => {
    const { applicationId } = await seed()
    await h.sql`update application set duplicate_flagged_at = now() where id = ${applicationId}`

    const otherChapter = await makeChapter(h.sql)
    const strangerId = await makeAdult(h.sql)
    const stranger = baseCtx(strangerId, new Date(), [mem('chapter_director', otherChapter)])

    let caught: unknown
    await withRequest(async () => {
      try {
        await service().clearDuplicateFlag(stranger, { applicationId })
      } catch (e) {
        caught = e
      }
    })

    expect(caught).toBeInstanceOf(Forbidden)
    const [row] = await h.sql`
      select duplicate_cleared_at, duplicate_cleared_by from application where id = ${applicationId}
    `
    expect(row!.duplicate_cleared_at).toBeNull()
    expect(row!.duplicate_cleared_by).toBeNull()
  })
})
