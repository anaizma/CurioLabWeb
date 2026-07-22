// -------------------------------------------------------------------------
// GuardianPortalService tests (Milestone 1 step 7) — the guardian portal
// read/request surface. Embedded Postgres, synthetic data only.
//
// Under test (03-authorization.md guardian scope + the guardian capability
// list; 05-api-surface.md "Guardian portal"; compliance-coppa.md Part 2 Stage 4
// review / refuse-further-use / delete rights; 02-data-model.md the request and
// fee tables):
//
//   - a verified guardian views their own child's record; the read logs exactly
//     one minor_record.read row (the logsRead obligation ran transactionally);
//   - a guardian of a DIFFERENT child, a lapsed/revoked edge, and an 18+ child
//     are each denied out_of_scope (the guardian scope requires a verified minor
//     child in ctx.guardianOf, subject age < 18);
//   - requestExport / requestDeletion file the request rows with the right
//     status/scope; a reason-less deletion refusal is rejected by the DB;
//   - viewFees reads payment status and scholarship WITHOUT any amount;
//   - every method is enforced through `authorize`: a stranger is denied with a
//     reason-less Forbidden and one permission.denied row;
//   - if the minor_record.read audit write fails, viewChildRecord fails closed
//     (the read rolls back, nothing is returned) — the obligation-fails-closed
//     contract from the runtime layer.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { AuthContext } from '@curiolab/core'
import { Forbidden, authorize, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMinor } from './helpers/fixtures.js'
import { baseCtx } from './helpers/ctx.js'
import { GuardianPortalService } from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

interface Child {
  chapter: string
  term: string
  pod: string
  director: string
  guardian: string
  child: string
  enrollmentId: string
}

/**
 * A verified-and-enrolled child: an active student membership in a pod with a
 * current tier, a bound enrollment record, and its guardian. `childDob` drives
 * the derived age (the guardian scope's age bound).
 */
async function seedChild(childDob = '2015-06-01'): Promise<Child> {
  const chapter = await makeChapter(h.sql)
  const [term] = await h.sql`
    insert into term (chapter_id, name, starts_on, ends_on)
    values (${chapter}, 'Fall Term 2099', '2099-09-01', '2099-12-15') returning id
  `
  const [pod] = await h.sql`
    insert into pod (chapter_id, term_id, name) values (${chapter}, ${term!.id}, 'Pod Alpha') returning id
  `
  const director = await makeAdult(h.sql)
  const guardian = await makeAdult(h.sql)
  const child = await makeMinor(h.sql, { dateOfBirth: childDob })
  await h.sql`
    insert into membership (account_id, chapter_id, role, status, term_id, pod_id, current_tier)
    values (${child}, ${chapter}, 'student', 'active', ${term!.id}, ${pod!.id}, 'builder')
  `
  const [app] = await h.sql`
    insert into application (
      kind, chapter_id, status, applicant_name, applicant_contact_email,
      guardian_name, guardian_email, created_at
    ) values (
      'student', ${chapter}, 'accepted', 'Minor Testchild', 'parent@example.test',
      'Parent Testperson', 'parent@example.test', '2026-06-01T00:00:00Z'
    ) returning id
  `
  const [enr] = await h.sql`
    insert into enrollment_record (
      application_id, student_account_id, chapter_id, term_id,
      signed_form_ref, guardian_name_on_form, created_by
    ) values (
      ${app!.id}, ${child}, ${chapter}, ${term!.id}, ${randomUUID()}, 'Parent Testperson', ${director}
    ) returning id
  `
  return {
    chapter,
    term: term!.id as string,
    pod: pod!.id as string,
    director,
    guardian,
    child,
    enrollmentId: enr!.id as string,
  }
}

/** A digital consent grant; the DB trigger maintains consent_current. */
async function grantConsent(
  f: Child,
  type: 'platform_participation' | 'public_profile',
): Promise<void> {
  await h.sql`
    insert into consent (
      student_account_id, type, action, source, source_ref,
      enrollment_record_id, scope_ref, granted_by, effective_at, reason
    ) values (
      ${f.child}, ${type}, 'grant', 'digital', ${null},
      ${f.enrollmentId}, ${null}, ${f.guardian}, now(), 'standard'
    )
  `
}

/** A guardian ctx whose verified edges (guardianOf) are exactly `children`. */
function guardianCtx(guardianId: string, children: string[]): AuthContext {
  return { ...baseCtx(guardianId, new Date()), guardianOf: children }
}

/**
 * A fault-injecting proxy over a real `Sql`: any tagged-template query whose
 * static text matches `shouldThrow` raises before it runs; transaction queries
 * (via `.begin`) are wrapped too. Mirrors the pattern in guardianship.test.ts so
 * atomicity is proven without a test-only production seam.
 */
function faulty(sql: Sql, shouldThrow: (queryText: string) => boolean): Sql {
  const handler: ProxyHandler<Sql> = {
    apply(target, thisArg, args) {
      const first = (args as unknown[])[0]
      if (Array.isArray(first) && shouldThrow(first.join(' '))) {
        throw new Error('injected fault: audit sink is down')
      }
      return Reflect.apply(target as (...a: unknown[]) => unknown, thisArg, args as unknown[])
    },
    get(target, prop, receiver) {
      if (prop === 'begin') {
        return (cb: (tx: Sql) => Promise<unknown>) =>
          target.begin((tx) => cb(new Proxy(tx as unknown as Sql, handler)))
      }
      const v = Reflect.get(target, prop, receiver)
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v
    },
  }
  return new Proxy(sql, handler)
}

async function auditRows(action: string, actor: string) {
  return h.sql`
    select detail from audit_entry where action = ${action} and actor_account_id = ${actor}
  `
}

// ===========================================================================
describe('viewChildRecord — a verified guardian reads their own child', () => {
  test('returns the composed record and logs exactly one minor_record.read', async () => {
    const f = await seedChild()
    await grantConsent(f, 'platform_participation')
    const svc = new GuardianPortalService({ sql: h.sql, authorize })
    const ctx = guardianCtx(f.guardian, [f.child])

    let record!: Awaited<ReturnType<GuardianPortalService['viewChildRecord']>>
    await withRequest(async () => {
      record = await svc.viewChildRecord(f.child, ctx)
    })

    expect(record).toBeDefined()
    expect(record!.childId).toBe(f.child)
    expect(record!.currentTier).toBe('builder')
    expect(record!.memberships.some((m) => m.role === 'student' && m.status === 'active')).toBe(true)
    // Consent summary reads consent_current: participation active, the rest not.
    expect(record!.consents.platform_participation).toBe(true)
    expect(record!.consents.public_profile).toBe(false)

    // The logsRead obligation wrote exactly one minor_record.read, transactionally.
    const logged = await auditRows('minor_record.read', f.guardian)
    expect(logged).toHaveLength(1)
    expect(logged[0]!.detail).toMatchObject({ obligation: 'minor_record.read' })
  })
})

describe('viewChildRecord — the guardian scope denies everyone else', () => {
  test('a guardian of a DIFFERENT child is denied out_of_scope', async () => {
    const mine = await seedChild()
    const other = await seedChild()
    const svc = new GuardianPortalService({ sql: h.sql, authorize })
    // The guardian is verified over `mine.child`, not over `other.child`.
    const ctx = guardianCtx(mine.guardian, [mine.child])

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc.viewChildRecord(other.child, ctx)
      } catch (e) {
        caught = e
      }
    })

    expect(caught).toBeInstanceOf(Forbidden)
    const denied = await auditRows('permission.denied', mine.guardian)
    expect(denied).toHaveLength(1)
    expect(denied[0]!.detail).toMatchObject({
      capability: 'guardian.view_child_record',
      reason: 'out_of_scope',
    })
  })

  test('a lapsed/revoked edge (absent from guardianOf) is denied out_of_scope', async () => {
    const f = await seedChild()
    const svc = new GuardianPortalService({ sql: h.sql, authorize })
    // A lapsed/revoked edge is not a verified edge, so it is absent from guardianOf.
    const ctx = guardianCtx(f.guardian, [])

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc.viewChildRecord(f.child, ctx)
      } catch (e) {
        caught = e
      }
    })

    expect(caught).toBeInstanceOf(Forbidden)
    const denied = await auditRows('permission.denied', f.guardian)
    expect(denied[0]!.detail).toMatchObject({ reason: 'out_of_scope' })
  })

  test('a guardian of an 18+ child is denied out_of_scope (authority ends at majority)', async () => {
    // DOB making the "child" an adult at request time.
    const f = await seedChild('2005-01-01')
    const svc = new GuardianPortalService({ sql: h.sql, authorize })
    // The edge is still listed, so age is the ONLY reason for the denial.
    const ctx = guardianCtx(f.guardian, [f.child])

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc.viewChildRecord(f.child, ctx)
      } catch (e) {
        caught = e
      }
    })

    expect(caught).toBeInstanceOf(Forbidden)
    const denied = await auditRows('permission.denied', f.guardian)
    expect(denied[0]!.detail).toMatchObject({ reason: 'out_of_scope' })
  })
})

describe('viewChildRecord — fails closed if the read log cannot be written', () => {
  test('a failing minor_record.read audit write rolls the read back and returns nothing', async () => {
    const f = await seedChild()
    // Fail the obligation's audit insert; the compose read is SELECT-only.
    const faultySql = faulty(h.sql, (q) => /insert into audit_entry/i.test(q))
    const svc = new GuardianPortalService({ sql: faultySql, authorize })
    const ctx = guardianCtx(f.guardian, [f.child])

    let caught: unknown
    let returned: unknown
    await withRequest(async () => {
      try {
        returned = await svc.viewChildRecord(f.child, ctx)
      } catch (e) {
        caught = e
      }
    })

    expect(caught).toBeInstanceOf(Error)
    expect(returned).toBeUndefined()
    // Nothing committed: no minor_record.read row survived the rollback.
    const logged = await auditRows('minor_record.read', f.guardian)
    expect(logged).toHaveLength(0)
  })
})

describe('viewFees — status and scholarship, never an amount', () => {
  test('reads payment status and scholarship percentage without any monetary amount', async () => {
    const f = await seedChild()
    await h.sql`
      insert into payment_ref (enrollment_record_id, stripe_customer_ref, status, tier_paid_for)
      values (${f.enrollmentId}, 'cus_synthetic', 'active', 'builder')
    `
    await h.sql`
      insert into scholarship (enrollment_record_id, awarded_by, percentage, note)
      values (${f.enrollmentId}, ${f.director}, 40, 'need-based')
    `
    const svc = new GuardianPortalService({ sql: h.sql, authorize })
    const ctx = guardianCtx(f.guardian, [f.child])

    let fees!: Awaited<ReturnType<GuardianPortalService['viewFees']>>
    await withRequest(async () => {
      fees = await svc.viewFees(f.child, ctx)
    })

    expect(fees!.paymentStatus).toBe('active')
    expect(fees!.tierPaidFor).toBe('builder')
    expect(fees!.scholarships).toHaveLength(1)
    expect(fees!.scholarships[0]!.percentage).toBe(40)
    // No amounts as a source of truth anywhere in the payload.
    expect(JSON.stringify(fees)).not.toMatch(/amount|dollar|\$/i)
  })

  test('a stranger is denied out_of_scope with a reason-less Forbidden', async () => {
    const f = await seedChild()
    const strangerId = await makeAdult(h.sql)
    const svc = new GuardianPortalService({ sql: h.sql, authorize })
    const ctx = guardianCtx(strangerId, []) // no verified edges

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc.viewFees(f.child, ctx)
      } catch (e) {
        caught = e
      }
    })

    expect(caught).toBeInstanceOf(Forbidden)
    expect(JSON.stringify(caught)).not.toMatch(/out_of_scope/)
    const denied = await auditRows('permission.denied', strangerId)
    expect(denied).toHaveLength(1)
    expect(denied[0]!.detail).toMatchObject({
      capability: 'guardian.view_fee_status',
      reason: 'out_of_scope',
    })
  })
})

describe('requestExport / requestDeletion — file the request rows', () => {
  test('requestExport files an export_request in requested', async () => {
    const f = await seedChild()
    const svc = new GuardianPortalService({ sql: h.sql, authorize })
    const ctx = guardianCtx(f.guardian, [f.child])

    let result!: Awaited<ReturnType<GuardianPortalService['requestExport']>>
    await withRequest(async () => {
      result = await svc.requestExport(f.child, ctx)
    })

    const [row] = await h.sql`select * from export_request where id = ${result.exportRequestId}`
    expect(row!.status).toBe('requested')
    expect(row!.subject_account_id).toBe(f.child)
    expect(row!.requested_by).toBe(f.guardian)
    expect(row!.fulfilled_at).toBeNull()
  })

  test('requestDeletion files a deletion_request in requested with the given scope', async () => {
    for (const scope of ['full', 'redaction'] as const) {
      const f = await seedChild()
      const svc = new GuardianPortalService({ sql: h.sql, authorize })
      const ctx = guardianCtx(f.guardian, [f.child])

      let result!: Awaited<ReturnType<GuardianPortalService['requestDeletion']>>
      await withRequest(async () => {
        result = await svc.requestDeletion(f.child, ctx, scope)
      })

      const [row] = await h.sql`select * from deletion_request where id = ${result.deletionRequestId}`
      expect(row!.status).toBe('requested')
      expect(row!.scope_requested).toBe(scope)
      expect(row!.decision_reason).toBeNull()
      expect(row!.decided_at).toBeNull()
    }
  })

  test('the DB enforces that a refusal carries a documented reason (service files only `requested`)', async () => {
    const f = await seedChild()
    // A reason-less refusal cannot be written by any path (the review step, later).
    await expect(
      h.sql`
        insert into deletion_request (subject_account_id, requested_by, scope_requested, status)
        values (${f.child}, ${f.guardian}, 'full', 'refused')
      `,
    ).rejects.toThrow(/deletion_request_refusal_reason|check/i)
  })

  test('a stranger cannot file a deletion request (denied, one permission.denied row, nothing filed)', async () => {
    const f = await seedChild()
    const strangerId = await makeAdult(h.sql)
    const svc = new GuardianPortalService({ sql: h.sql, authorize })
    const ctx = guardianCtx(strangerId, [])

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc.requestDeletion(f.child, ctx, 'full')
      } catch (e) {
        caught = e
      }
    })

    expect(caught).toBeInstanceOf(Forbidden)
    const denied = await auditRows('permission.denied', strangerId)
    expect(denied).toHaveLength(1)
    expect(denied[0]!.detail).toMatchObject({ capability: 'guardian.request_deletion', reason: 'out_of_scope' })
    const filed = await h.sql`select 1 from deletion_request where requested_by = ${strangerId}`
    expect(filed).toHaveLength(0)
  })
})

describe('viewDigest — the chapter digest for a guardian', () => {
  test('a guardian with a verified minor child gets a digest', async () => {
    const f = await seedChild()
    const svc = new GuardianPortalService({ sql: h.sql, authorize })
    const ctx = guardianCtx(f.guardian, [f.child])

    let digest!: Awaited<ReturnType<GuardianPortalService['viewDigest']>>
    await withRequest(async () => {
      digest = await svc.viewDigest(ctx)
    })

    expect(digest).toBeDefined()
    expect(digest!.chapterId).toBe(f.chapter)
  })

  test('a stranger with no verified children is denied out_of_scope', async () => {
    const strangerId = await makeAdult(h.sql)
    const svc = new GuardianPortalService({ sql: h.sql, authorize })
    const ctx = guardianCtx(strangerId, [])

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc.viewDigest(ctx)
      } catch (e) {
        caught = e
      }
    })

    expect(caught).toBeInstanceOf(Forbidden)
    const denied = await auditRows('permission.denied', strangerId)
    expect(denied).toHaveLength(1)
    expect(denied[0]!.detail).toMatchObject({ capability: 'guardian.view_digest', reason: 'out_of_scope' })
  })
})
