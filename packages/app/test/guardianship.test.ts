// -------------------------------------------------------------------------
// GuardianshipService tests (Milestone 1 step 4) — guardian verification and
// the name match (Flow A step 6, the authority floor; 04-state-machines
// guardianship pending -> verified / pending -> rejected). Embedded Postgres,
// synthetic data only.
//
// The two rulings under test:
//   1. `consent` is append-only: verification MUST NOT touch any consent row.
//      Form-sourced consents keep `granted_by = null`; provenance is carried by
//      the verified edge's `source_ref` (the signed-form scan), not a backfill.
//   2. Verification writes the edge's own provenance fields (write-once) and, on
//      mismatch, rejects the edge AND closes the accepting account in ONE
//      transaction.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Forbidden, authorize, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMinor } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import {
  GuardianshipService,
  IllegalGuardianshipTransitionError,
  GuardianshipNotFoundError,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

interface SetupOptions {
  guardianLegalName: string
  guardianNameOnForm: string
  guardianStatus?: 'pending' | 'active' | 'closed'
  edgeStatus?: 'pending' | 'verified' | 'rejected'
}

interface SetupResult {
  chapter: string
  term: string
  director: string
  student: string
  guardian: string
  signedFormRef: string
  enrollmentId: string
  guardianshipId: string
}

// Build the post-accept state of Flow A: an accepted application, its enrollment
// record with the signed-form ref and the guardian name on the form, the two
// form-sourced consents (granted_by null), the accepting guardian account, and a
// pending guardianship edge bound to the student.
async function setup(opts: SetupOptions): Promise<SetupResult> {
  const chapter = await makeChapter(h.sql)
  const [term] = await h.sql`
    insert into term (chapter_id, name, starts_on, ends_on)
    values (${chapter}, 'Fall Term 2099', '2099-09-01', '2099-12-15') returning id
  `
  const director = await makeAdult(h.sql)
  const student = await makeMinor(h.sql)
  const signedFormRef = randomUUID()

  const [g] = await h.sql`
    insert into account (
      email, username, legal_name, display_name, date_of_birth,
      dob_provenance, dob_source_ref, credential_owner, status, maturation_state
    ) values (
      ${`guardian-${randomUUID()}@example.test`}, ${null}, ${opts.guardianLegalName}, 'Guardian G.',
      '1985-01-01', 'self_reported', ${null}, 'self_private', ${opts.guardianStatus ?? 'pending'}, 'self_managed'
    ) returning id
  `
  const guardian = g!.id as string

  const [app] = await h.sql`
    insert into application (
      kind, chapter_id, status, applicant_name, applicant_contact_email,
      guardian_name, guardian_email, created_at
    ) values (
      'student', ${chapter}, 'accepted', 'Minor Testchild', 'guardian@example.test',
      ${opts.guardianNameOnForm}, 'guardian@example.test', '2026-06-01T00:00:00Z'
    ) returning id
  `
  const [enr] = await h.sql`
    insert into enrollment_record (
      application_id, student_account_id, chapter_id, term_id,
      signed_form_ref, guardian_name_on_form, created_by
    ) values (
      ${app!.id}, ${student}, ${chapter}, ${term!.id},
      ${signedFormRef}, ${opts.guardianNameOnForm}, ${director}
    ) returning id
  `
  const enrollmentId = enr!.id as string

  for (const type of ['enrollment', 'data_collection'] as const) {
    await h.sql`
      insert into consent (
        student_account_id, type, action, source, source_ref,
        enrollment_record_id, granted_by, effective_at, reason
      ) values (
        ${student}, ${type}, 'grant', 'signed_form', ${signedFormRef},
        ${enrollmentId}, ${null}, '2026-06-15T00:00:00Z', 'standard'
      )
    `
  }

  const [edge] = await h.sql`
    insert into guardianship (
      guardian_account_id, student_account_id, relationship, status,
      verification_method, verified_by, source_ref, verified_at
    ) values (
      ${guardian}, ${student}, 'guardian', ${opts.edgeStatus ?? 'pending'},
      'signed_form_match', ${null}, ${null}, ${null}
    ) returning id
  `

  return {
    chapter,
    term: term!.id as string,
    director,
    student,
    guardian,
    signedFormRef,
    enrollmentId,
    guardianshipId: edge!.id as string,
  }
}

async function edgeRow(id: string) {
  const [row] = await h.sql`select * from guardianship where id = ${id}`
  return row!
}
async function accountStatus(id: string): Promise<string> {
  const [row] = await h.sql`select status from account where id = ${id}`
  return row!.status as string
}

/**
 * A fault-injecting proxy over a real `Sql`. Any tagged-template query whose
 * text matches `shouldThrow` raises before it runs; nested transaction queries
 * (via `.begin`) are wrapped too, so a fault mid-transaction aborts the whole
 * thing. This lets a test prove atomicity without a test-only production seam.
 */
function faulty(sql: Sql, shouldThrow: (queryText: string) => boolean): Sql {
  const handler: ProxyHandler<Sql> = {
    apply(target, thisArg, args) {
      const first = (args as unknown[])[0]
      if (Array.isArray(first) && shouldThrow(first.join(' '))) {
        throw new Error('injected fault: account close boom')
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

describe('a matching name verifies the edge (Flow A step 6, match)', () => {
  test('sets status verified + verified_by/source_ref/verified_at + method, closes nothing, touches no consent', async () => {
    const f = await setup({ guardianLegalName: 'Parent Testperson', guardianNameOnForm: 'Parent Testperson' })
    const ctx = baseCtx(f.director, new Date(), [mem('chapter_director', f.chapter)])
    const svc = new GuardianshipService({ sql: h.sql, authorize })

    let result!: Awaited<ReturnType<GuardianshipService['verifyGuardianship']>>
    await withRequest(async () => {
      result = await svc.verifyGuardianship(f.guardianshipId, ctx)
    })

    const edge = await edgeRow(f.guardianshipId)
    expect(edge.status).toBe('verified')
    expect(edge.verified_by).toBe(f.director)
    expect(edge.source_ref).toBe(f.signedFormRef)
    expect(edge.verified_at).not.toBeNull()
    expect(edge.verification_method).toBe('signed_form_match')

    // The accepting account stays as it was; a match does not close it.
    expect(await accountStatus(f.guardian)).toBe('pending')

    // Ruling 1: consent is append-only and untouched — still exactly the two
    // form-sourced rows, each still granted_by null (NOT backfilled).
    const consents = await h.sql`select granted_by from consent where student_account_id = ${f.student}`
    expect(consents).toHaveLength(2)
    for (const c of consents) expect(c.granted_by).toBeNull()

    expect(result).toMatchObject({ status: 'verified', matched: true, accountClosed: false })
  })

  test('verification_method defaults to the config value and accepts in_person_witnessed as input', async () => {
    const a = await setup({ guardianLegalName: 'Parent Testperson', guardianNameOnForm: 'Parent Testperson' })
    const b = await setup({ guardianLegalName: 'Parent Testperson', guardianNameOnForm: 'Parent Testperson' })
    const svc = new GuardianshipService({ sql: h.sql, authorize })

    await withRequest(async () => {
      await svc.verifyGuardianship(a.guardianshipId, baseCtx(a.director, new Date(), [mem('chapter_director', a.chapter)]))
      await svc.verifyGuardianship(
        b.guardianshipId,
        baseCtx(b.director, new Date(), [mem('chapter_director', b.chapter)]),
        { verificationMethod: 'in_person_witnessed' },
      )
    })

    expect((await edgeRow(a.guardianshipId)).verification_method).toBe('signed_form_match')
    expect((await edgeRow(b.guardianshipId)).verification_method).toBe('in_person_witnessed')
  })

  test('normalization: names differing only by case and internal whitespace still match', async () => {
    const f = await setup({ guardianLegalName: '  parent   TESTPERSON  ', guardianNameOnForm: 'Parent Testperson' })
    const ctx = baseCtx(f.director, new Date(), [mem('chapter_director', f.chapter)])
    const svc = new GuardianshipService({ sql: h.sql, authorize })

    await withRequest(async () => {
      await svc.verifyGuardianship(f.guardianshipId, ctx)
    })
    expect((await edgeRow(f.guardianshipId)).status).toBe('verified')
  })
})

describe('a mismatched name rejects the edge and closes the account (Flow A step 6, mismatch)', () => {
  test('sets status rejected, closes the accepting account, leaves verification facts null, touches no consent', async () => {
    const f = await setup({ guardianLegalName: 'Somebody Else', guardianNameOnForm: 'Parent Testperson' })
    const ctx = baseCtx(f.director, new Date(), [mem('chapter_director', f.chapter)])
    const svc = new GuardianshipService({ sql: h.sql, authorize })

    let result!: Awaited<ReturnType<GuardianshipService['verifyGuardianship']>>
    await withRequest(async () => {
      result = await svc.verifyGuardianship(f.guardianshipId, ctx)
    })

    const edge = await edgeRow(f.guardianshipId)
    expect(edge.status).toBe('rejected')
    expect(edge.verified_by).toBeNull()
    expect(edge.source_ref).toBeNull()
    expect(edge.verified_at).toBeNull()

    expect(await accountStatus(f.guardian)).toBe('closed')

    const consents = await h.sql`select granted_by from consent where student_account_id = ${f.student}`
    expect(consents).toHaveLength(2)
    for (const c of consents) expect(c.granted_by).toBeNull()

    expect(result).toMatchObject({ status: 'rejected', matched: false, accountClosed: true })
  })

  test('atomicity: a failure while closing the account rolls back the reject too — neither persists', async () => {
    const f = await setup({ guardianLegalName: 'Somebody Else', guardianNameOnForm: 'Parent Testperson' })
    const ctx = baseCtx(f.director, new Date(), [mem('chapter_director', f.chapter)])
    const faultySql = faulty(h.sql, (q) => /update account/i.test(q))
    const svc = new GuardianshipService({ sql: faultySql, authorize })

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc.verifyGuardianship(f.guardianshipId, ctx)
      } catch (e) {
        caught = e
      }
    })

    expect((caught as Error).message).toMatch(/account close boom/)
    // Rolled back: the edge is still pending and the account still open.
    expect((await edgeRow(f.guardianshipId)).status).toBe('pending')
    expect(await accountStatus(f.guardian)).toBe('pending')
  })
})

describe('authorization is enforced through authorize', () => {
  test('a non-director (lead_instructor) is denied: opaque Forbidden, one reasoned permission.denied row, nothing persists', async () => {
    const f = await setup({ guardianLegalName: 'Parent Testperson', guardianNameOnForm: 'Parent Testperson' })
    const leadId = await makeAdult(h.sql)
    const ctx = baseCtx(leadId, new Date(), [mem('lead_instructor', f.chapter)])
    const svc = new GuardianshipService({ sql: h.sql, authorize })

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc.verifyGuardianship(f.guardianshipId, ctx)
      } catch (e) {
        caught = e
      }
    })

    expect(caught).toBeInstanceOf(Forbidden)
    // The client-facing error leaks no reason.
    expect(JSON.stringify(caught)).not.toMatch(/role_not_permitted/)

    const denied = await h.sql`
      select detail from audit_entry
      where action = 'permission.denied' and actor_account_id = ${leadId}
    `
    expect(denied).toHaveLength(1)
    expect(denied[0]!.detail).toMatchObject({ capability: 'guardianship.verify', reason: 'role_not_permitted' })

    // Denial precedes the transaction: no state changed.
    expect((await edgeRow(f.guardianshipId)).status).toBe('pending')
    expect(await accountStatus(f.guardian)).toBe('pending')
  })

  test('a director in another chapter is denied out_of_scope and nothing persists', async () => {
    const f = await setup({ guardianLegalName: 'Somebody Else', guardianNameOnForm: 'Parent Testperson' })
    const otherChapter = await makeChapter(h.sql)
    const strangerId = await makeAdult(h.sql)
    const ctx = baseCtx(strangerId, new Date(), [mem('chapter_director', otherChapter)])
    const svc = new GuardianshipService({ sql: h.sql, authorize })

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc.verifyGuardianship(f.guardianshipId, ctx)
      } catch (e) {
        caught = e
      }
    })

    expect(caught).toBeInstanceOf(Forbidden)
    const denied = await h.sql`
      select detail from audit_entry
      where action = 'permission.denied' and actor_account_id = ${strangerId}
    `
    expect(denied).toHaveLength(1)
    expect(denied[0]!.detail).toMatchObject({ capability: 'guardianship.verify', reason: 'out_of_scope' })

    // A mismatch would have closed the account; out_of_scope must leave it open.
    expect((await edgeRow(f.guardianshipId)).status).toBe('pending')
    expect(await accountStatus(f.guardian)).toBe('pending')
  })
})

describe('illegal transitions are rejected via canTransition', () => {
  test('verifying an already-verified edge is rejected (illegal_transition), nothing persists', async () => {
    const f = await setup({
      guardianLegalName: 'Parent Testperson',
      guardianNameOnForm: 'Parent Testperson',
      edgeStatus: 'verified',
    })
    const ctx = baseCtx(f.director, new Date(), [mem('chapter_director', f.chapter)])
    const svc = new GuardianshipService({ sql: h.sql, authorize })

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc.verifyGuardianship(f.guardianshipId, ctx)
      } catch (e) {
        caught = e
      }
    })

    expect(caught).toBeInstanceOf(IllegalGuardianshipTransitionError)
    expect((caught as IllegalGuardianshipTransitionError).reason).toBe('illegal_transition')
    expect((await edgeRow(f.guardianshipId)).status).toBe('verified')
  })

  test('verifying an already-rejected (terminal) edge is rejected (terminal_state)', async () => {
    const f = await setup({
      guardianLegalName: 'Parent Testperson',
      guardianNameOnForm: 'Parent Testperson',
      edgeStatus: 'rejected',
    })
    const ctx = baseCtx(f.director, new Date(), [mem('chapter_director', f.chapter)])
    const svc = new GuardianshipService({ sql: h.sql, authorize })

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc.verifyGuardianship(f.guardianshipId, ctx)
      } catch (e) {
        caught = e
      }
    })

    expect(caught).toBeInstanceOf(IllegalGuardianshipTransitionError)
    expect((caught as IllegalGuardianshipTransitionError).reason).toBe('terminal_state')
  })
})

describe('an unknown guardianship id is a typed not-found', () => {
  test('throws GuardianshipNotFoundError', async () => {
    const f = await setup({ guardianLegalName: 'Parent Testperson', guardianNameOnForm: 'Parent Testperson' })
    const ctx = baseCtx(f.director, new Date(), [mem('chapter_director', f.chapter)])
    const svc = new GuardianshipService({ sql: h.sql, authorize })

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc.verifyGuardianship(randomUUID(), ctx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(GuardianshipNotFoundError)
  })
})
