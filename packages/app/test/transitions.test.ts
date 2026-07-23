import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { authorize, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import { ApplicationService } from '../src/index.js'
import { writeApplicationEvent } from '../src/events.js'
import { IllegalTransitionError } from '../src/errors.js'

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
