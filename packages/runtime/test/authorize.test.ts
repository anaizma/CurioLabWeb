import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { AuthContext, Resource } from '@curiolab/core'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMinor } from './helpers/fixtures.js'
import { writeAudit } from '../src/audit.js'
import { authorize } from '../src/authorize.js'
import { Forbidden } from '../src/errors.js'
import { withRequest } from '../src/context.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

function baseCtx(actorId: string, now: Date): AuthContext {
  return {
    now: now.getTime(),
    account: {
      id: actorId,
      status: 'active',
      age: 40,
      maturation_state: 'self_managed',
      credential_owner: 'self_private',
    },
    session: { mode: 'full', expires_at: now.getTime() + 60_000, revoked_at: null },
    memberships: [],
    guardianOf: [],
    consentsByChild: new Map(),
  }
}

describe('writeAudit', () => {
  test('appends an audit_entry row and returns its id, detail as jsonb', async () => {
    const actor = await makeAdult(h.sql)
    const id = await writeAudit(h.sql, {
      action: 'test.event',
      subjectType: 'account',
      subjectId: null,
      actorAccountId: actor,
      detail: { ref: 'some-uuid', note: 'references not PII' },
    })
    const [row] = await h.sql`select action, subject_type, detail from audit_entry where id = ${id}`
    expect(row!.action).toBe('test.event')
    expect(row!.detail).toEqual({ ref: 'some-uuid', note: 'references not PII' })
  })
})

describe('authorize — denial (must-not #8, #21)', () => {
  test('a denied decision writes exactly one permission.denied row and throws an opaque Forbidden', async () => {
    const actor = await makeAdult(h.sql)
    const now = new Date()
    // No membership anywhere -> feed.comment resolves out_of_scope.
    const ctx = baseCtx(actor, now)
    const resource: Resource = { id: randomUUID(), chapter_id: randomUUID(), pod_id: randomUUID() }

    let caught: unknown
    await withRequest(async () => {
      try {
        await authorize(ctx, 'feed.comment', resource, { sql: h.sql })
      } catch (e) {
        caught = e
      }
    })

    // must-not #21: generic Forbidden, no reason leaked onto the error.
    expect(caught).toBeInstanceOf(Forbidden)
    expect(JSON.stringify(caught)).not.toMatch(/out_of_scope/)
    expect((caught as Record<string, unknown>).reason).toBeUndefined()

    // must-not #8: exactly one permission.denied row, carrying the full reason.
    const rows = await h.sql`
      select action, detail from audit_entry
      where action = 'permission.denied' and actor_account_id = ${actor}
    `
    expect(rows).toHaveLength(1)
    expect(rows[0]!.detail).toMatchObject({ capability: 'feed.comment', reason: 'out_of_scope' })
  })
})

describe('authorize — allow with a transactional minor_record.read obligation', () => {
  // student.view_record has logsRead: a teaching actor reading a minor OUTSIDE
  // their pod emits a transactional minor_record.read obligation.
  async function setup() {
    const now = new Date()
    const chapter = await makeChapter(h.sql)
    const actor = await makeAdult(h.sql)
    const minor = await makeMinor(h.sql)
    const actorPod = randomUUID()
    const ctx: AuthContext = {
      ...baseCtx(actor, now),
      memberships: [
        {
          chapter_id: chapter,
          role: 'lead_instructor',
          status: 'active',
          pod_id: actorPod,
          tier: null,
          active_from: null,
          active_until: null,
        },
      ],
    }
    const resource: Resource = {
      id: randomUUID(),
      chapter_id: chapter,
      subjectAccountId: minor,
      subjectIsMinor: true,
      subjectPodId: randomUUID(), // a DIFFERENT pod -> read must be logged
    }
    return { ctx, resource, actor, minor, chapter, now }
  }

  test('happy path: the read returns and both the read marker and the minor_record.read row commit', async () => {
    const { ctx, resource, actor, minor } = await setup()

    const result = await withRequest(() =>
      authorize<string>(ctx, 'student.view_record', resource, {
        sql: h.sql,
        read: async (tx) => {
          await writeAudit(tx, {
            action: 'test.read_marker',
            subjectType: 'account',
            subjectId: minor,
            actorAccountId: actor,
          })
          return 'STUDENT_RECORD'
        },
      }),
    )

    expect(result).toBe('STUDENT_RECORD')
    const marker = await h.sql`
      select 1 from audit_entry where action = 'test.read_marker' and actor_account_id = ${actor}
    `
    const logged = await h.sql`
      select 1 from audit_entry where action = 'minor_record.read' and actor_account_id = ${actor}
    `
    expect(marker).toHaveLength(1)
    expect(logged).toHaveLength(1)
  })

  test('obligation fails closed: a failing audit write rolls back the read, nothing returned (must-not #25)', async () => {
    const { ctx, resource, actor, minor } = await setup()

    let caught: unknown
    let returned: string | undefined
    await withRequest(async () => {
      try {
        returned = await authorize<string>(ctx, 'student.view_record', resource, {
          sql: h.sql,
          read: async (tx) => {
            await writeAudit(tx, {
              action: 'test.read_marker',
              subjectType: 'account',
              subjectId: minor,
              actorAccountId: actor,
            })
            return 'STUDENT_RECORD'
          },
          // Inject a failing audit write for the minor_record.read obligation.
          auditWriter: async () => {
            throw new Error('audit sink is down')
          },
        })
      } catch (e) {
        caught = e
      }
    })

    // The read transaction rolled back: no value surfaced, and the read's own
    // marker write is gone even though it "succeeded" before the obligation.
    expect(caught).toBeInstanceOf(Error)
    expect(returned).toBeUndefined()
    const marker = await h.sql`
      select 1 from audit_entry where action = 'test.read_marker' and actor_account_id = ${actor}
    `
    expect(marker).toHaveLength(0)
  })
})
