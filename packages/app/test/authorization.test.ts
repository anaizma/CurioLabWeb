import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Forbidden, authorize, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import { ApplicationService, type AuthorizeFn } from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

/**
 * A `submitted` application created directly in a fixture. The public write no
 * longer mints an `application` (that path became `LeadService.createLead`; the
 * `application` is created only at 2C submit, part B), so authorization on the
 * ops transitions is exercised against a directly-seeded application.
 */
async function submittedApplication() {
  const chapter = await makeChapter(h.sql)
  const tag = randomUUID().slice(0, 8)
  const [row] = await h.sql`
    insert into application (
      kind, chapter_id, status, applicant_name, applicant_contact_email,
      guardian_name, guardian_email
    ) values (
      'student', ${chapter}, 'submitted', ${`Persimmon Wobblethorpe ${tag}`},
      ${`wob.${tag}@example.test`}, 'Guardian Wobblethorpe', ${`wob.${tag}@example.test`}
    ) returning id
  `
  return { chapter, applicationId: row!.id as string }
}

async function statusOf(id: string): Promise<string> {
  const [row] = await h.sql`select status from application where id = ${id}`
  return row!.status as string
}
async function eventCount(id: string): Promise<number> {
  const [row] = await h.sql`select count(*)::int as n from application_event where application_id = ${id}`
  return row!.n as number
}

describe('authorization is enforced on ops transitions', () => {
  test('an unauthorized actor is denied through authorize: one permission.denied row, opaque Forbidden, no mutation', async () => {
    const { chapter, applicationId } = await submittedApplication()

    // A director in a DIFFERENT chapter -> out_of_scope for this application.
    const otherChapter = await makeChapter(h.sql)
    const strangerId = await makeAdult(h.sql)
    const stranger = baseCtx(strangerId, new Date(), [mem('chapter_director', otherChapter)])

    let caught: unknown
    await withRequest(async () => {
      try {
        await new ApplicationService({ sql: h.sql, authorize }).screen(stranger, { applicationId })
      } catch (e) {
        caught = e
      }
    })

    // Opaque Forbidden, no reason leaked onto the error (must-not #21).
    expect(caught).toBeInstanceOf(Forbidden)
    expect(JSON.stringify(caught)).not.toMatch(/out_of_scope/)

    // Exactly one permission.denied row carrying the structured reason.
    const denied = await h.sql`
      select detail from audit_entry
      where action = 'permission.denied' and actor_account_id = ${strangerId}
    `
    expect(denied).toHaveLength(1)
    expect(denied[0]!.detail).toMatchObject({ capability: 'application.transition', reason: 'out_of_scope' })

    // The backstop holds in spirit: no mutation slipped through.
    expect(await statusOf(applicationId)).toBe('submitted')
    expect(await eventCount(applicationId)).toBe(0)
    void chapter
  })

  test('the runtime backstop still holds: an authorize that allows without recording a decision cannot mutate', async () => {
    const { chapter, applicationId } = await submittedApplication()
    const directorId = await makeAdult(h.sql)
    const director = baseCtx(directorId, new Date(), [mem('chapter_director', chapter)])

    // A misbehaving authorize: it "allows" (never throws) but does NOT record a
    // decision on the request context. The repository-write backstop must still
    // block the mutation (assertAuthorized throws inside the write transaction).
    const allowWithoutRecording: AuthorizeFn = async () => undefined

    let caught: unknown
    await withRequest(async () => {
      try {
        await new ApplicationService({ sql: h.sql, authorize: allowWithoutRecording }).screen(
          director,
          { applicationId },
        )
      } catch (e) {
        caught = e
      }
    })

    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toMatch(/no authorization decision recorded/)
    // Nothing mutated.
    expect(await statusOf(applicationId)).toBe('submitted')
    expect(await eventCount(applicationId)).toBe(0)
  })
})
