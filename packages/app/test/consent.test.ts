// -------------------------------------------------------------------------
// ConsentService tests (Milestone 1 step 5) — DIGITAL consent capture after
// verification, config-driven blocks, and the guardian/own age boundary.
// Embedded Postgres, synthetic data only.
//
// Under test (compliance-coppa.md Part 2 Stage 2, 1.4; 02-data-model consent /
// consent_current; 03-authorization consent.grant/revoke; 04-state-machines the
// consent event list + couplings C1/C2, whose CONTENT cascade is deferred to
// M2/M3 — the revoke row and the consent_current flip work now):
//
//   - a guardian grants Block B and each Block C type for a child under 18;
//   - external_publication requires a scope_ref;
//   - the guardian path is barred at 18; an 18+ student self-grants; a <18
//     student cannot self-grant;
//   - revoke is append-only and flips consent_current; a re-grant flips it back;
//   - a stranger is denied with a reason-less Forbidden + a permission.denied row.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import type { AuthContext } from '@curiolab/core'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Forbidden, authorize, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMinor } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import {
  ConsentService,
  ConsentScopeRefRequiredError,
  ConsentNotDigitallyGrantableError,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

interface SetupResult {
  chapter: string
  term: string
  director: string
  student: string
  guardian: string
  enrollmentId: string
}

// Post-verification state: an accepted application (past submission), an
// enrollment record bound to the student, the accepting guardian account, and
// the student account. Consent authority is expressed on the ctx (guardianOf /
// own membership); the service resolves the enrollment anchor and the student's
// age from the database.
async function setup(studentDob = '2015-06-01'): Promise<SetupResult> {
  const chapter = await makeChapter(h.sql)
  const [term] = await h.sql`
    insert into term (chapter_id, name, starts_on, ends_on)
    values (${chapter}, 'Fall Term 2099', '2099-09-01', '2099-12-15') returning id
  `
  const director = await makeAdult(h.sql)
  const student = await makeMinor(h.sql, { dateOfBirth: studentDob })
  const guardian = await makeAdult(h.sql)
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
      ${app!.id}, ${student}, ${chapter}, ${term!.id},
      ${randomUUID()}, 'Parent Testperson', ${director}
    ) returning id
  `
  return { chapter, term: term!.id as string, director, student, guardian, enrollmentId: enr!.id as string }
}

/** A guardian ctx with verified authority over the given children. */
function guardianCtx(guardianId: string, children: string[]): AuthContext {
  return { ...baseCtx(guardianId, new Date()), guardianOf: children }
}

/** A self-managing student ctx at a given age, holding a student membership. */
function selfStudentCtx(studentId: string, chapter: string, age: number): AuthContext {
  const b = baseCtx(studentId, new Date(), [mem('student', chapter)])
  return { ...b, account: { ...b.account, age } }
}

async function currentActive(student: string, type: string): Promise<boolean | undefined> {
  const [row] = await h.sql`
    select active from consent_current where student_account_id = ${student} and type = ${type}
  `
  return row?.active as boolean | undefined
}
async function consentRows(student: string, type: string) {
  return h.sql`
    select action, source, granted_by, enrollment_record_id, scope_ref, effective_at, seq
    from consent where student_account_id = ${student} and type = ${type}
    order by seq asc
  `
}

describe('a guardian grants the digital consents for a child under 18', () => {
  test('Block B (platform_participation): a digital grant, consent_current active, anchored + attributed', async () => {
    const f = await setup()
    const ctx = guardianCtx(f.guardian, [f.student])
    const svc = new ConsentService({ sql: h.sql, authorize })

    await withRequest(async () => {
      await svc.grantConsent(f.student, 'platform_participation', ctx)
    })

    expect(await currentActive(f.student, 'platform_participation')).toBe(true)
    const rows = await consentRows(f.student, 'platform_participation')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.action).toBe('grant')
    expect(rows[0]!.source).toBe('digital')
    expect(rows[0]!.granted_by).toBe(f.guardian)
    expect(rows[0]!.enrollment_record_id).toBe(f.enrollmentId)
  })

  test('each Block C type becomes active (public_profile, photo_media, external_publication)', async () => {
    const f = await setup()
    const ctx = guardianCtx(f.guardian, [f.student])
    const svc = new ConsentService({ sql: h.sql, authorize })
    const scope = randomUUID()

    await withRequest(async () => {
      await svc.grantConsent(f.student, 'public_profile', ctx)
      await svc.grantConsent(f.student, 'photo_media', ctx)
      await svc.grantConsent(f.student, 'external_publication', ctx, { scopeRef: scope })
    })

    expect(await currentActive(f.student, 'public_profile')).toBe(true)
    expect(await currentActive(f.student, 'photo_media')).toBe(true)
    expect(await currentActive(f.student, 'external_publication')).toBe(true)
    const ext = await consentRows(f.student, 'external_publication')
    expect(ext[0]!.scope_ref).toBe(scope)
  })
})

describe('external_publication requires a scope_ref (per-item, never blanket)', () => {
  test('without a scope_ref it is rejected and nothing persists', async () => {
    const f = await setup()
    const ctx = guardianCtx(f.guardian, [f.student])
    const svc = new ConsentService({ sql: h.sql, authorize })

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc.grantConsent(f.student, 'external_publication', ctx)
      } catch (e) {
        caught = e
      }
    })

    expect(caught).toBeInstanceOf(ConsentScopeRefRequiredError)
    expect(await consentRows(f.student, 'external_publication')).toHaveLength(0)
  })

  test('with a scope_ref it is accepted', async () => {
    const f = await setup()
    const ctx = guardianCtx(f.guardian, [f.student])
    const svc = new ConsentService({ sql: h.sql, authorize })

    await withRequest(async () => {
      await svc.grantConsent(f.student, 'external_publication', ctx, { scopeRef: randomUUID() })
    })
    expect(await currentActive(f.student, 'external_publication')).toBe(true)
  })
})

describe('a Block A (form-sourced) type cannot be granted digitally', () => {
  test('grantConsent for data_collection is rejected as form-sourced', async () => {
    const f = await setup()
    const ctx = guardianCtx(f.guardian, [f.student])
    const svc = new ConsentService({ sql: h.sql, authorize })

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc.grantConsent(f.student, 'data_collection', ctx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(ConsentNotDigitallyGrantableError)
    expect(await consentRows(f.student, 'data_collection')).toHaveLength(0)
  })
})

describe('the guardian/own age boundary', () => {
  test('the guardian path is barred once the child is 18 (out_of_scope, reason-less Forbidden)', async () => {
    const f = await setup('2007-01-01') // 18+ as of 2026-07-22
    const ctx = guardianCtx(f.guardian, [f.student])
    const svc = new ConsentService({ sql: h.sql, authorize })

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc.grantConsent(f.student, 'platform_participation', ctx)
      } catch (e) {
        caught = e
      }
    })

    expect(caught).toBeInstanceOf(Forbidden)
    expect(JSON.stringify(caught)).not.toMatch(/out_of_scope/)
    const denied = await h.sql`
      select detail from audit_entry
      where action = 'permission.denied' and actor_account_id = ${f.guardian}
    `
    expect(denied).toHaveLength(1)
    expect(denied[0]!.detail).toMatchObject({ capability: 'consent.grant', reason: 'out_of_scope' })
    expect(await consentRows(f.student, 'platform_participation')).toHaveLength(0)
  })

  test('a self-managing 18+ student grants their OWN consent via the own path', async () => {
    const f = await setup('2007-01-01')
    const ctx = selfStudentCtx(f.student, f.chapter, 18)
    const svc = new ConsentService({ sql: h.sql, authorize })

    await withRequest(async () => {
      await svc.grantConsent(f.student, 'platform_participation', ctx)
    })

    expect(await currentActive(f.student, 'platform_participation')).toBe(true)
    const rows = await consentRows(f.student, 'platform_participation')
    expect(rows[0]!.granted_by).toBe(f.student) // self-attributed
  })

  test('a student under 18 cannot self-grant (out_of_scope)', async () => {
    const f = await setup()
    const ctx = selfStudentCtx(f.student, f.chapter, 15)
    const svc = new ConsentService({ sql: h.sql, authorize })

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc.grantConsent(f.student, 'platform_participation', ctx)
      } catch (e) {
        caught = e
      }
    })

    expect(caught).toBeInstanceOf(Forbidden)
    expect(await consentRows(f.student, 'platform_participation')).toHaveLength(0)
  })
})

describe('revoke is append-only and flips consent_current', () => {
  test('a revoke inserts a new action=revoke row (never an update) and consent_current goes inactive', async () => {
    const f = await setup()
    const ctx = guardianCtx(f.guardian, [f.student])
    const svc = new ConsentService({ sql: h.sql, authorize })

    await withRequest(async () => {
      await svc.grantConsent(f.student, 'platform_participation', ctx)
      await svc.revokeConsent(f.student, 'platform_participation', ctx)
    })

    // Two rows: the grant is untouched (append-only), the revoke is a new row.
    const rows = await consentRows(f.student, 'platform_participation')
    expect(rows.map((r) => r.action)).toEqual(['grant', 'revoke'])
    expect(rows[1]!.source).toBe('digital')
    expect(await currentActive(f.student, 'platform_participation')).toBe(false)
  })

  test('a re-grant after a revoke flips consent_current active again (latest decision wins)', async () => {
    const f = await setup()
    const ctx = guardianCtx(f.guardian, [f.student])
    const svc = new ConsentService({ sql: h.sql, authorize })

    await withRequest(async () => {
      await svc.grantConsent(f.student, 'platform_participation', ctx)
      await svc.revokeConsent(f.student, 'platform_participation', ctx)
      await svc.grantConsent(f.student, 'platform_participation', ctx)
    })

    const rows = await consentRows(f.student, 'platform_participation')
    expect(rows.map((r) => r.action)).toEqual(['grant', 'revoke', 'grant'])
    expect(await currentActive(f.student, 'platform_participation')).toBe(true)
  })
})

describe('a stranger (not guardian, not self) is denied', () => {
  test('consent.grant denies with a reason-less Forbidden and one permission.denied row', async () => {
    const f = await setup()
    const strangerId = await makeAdult(h.sql)
    const ctx = baseCtx(strangerId, new Date()) // no guardianOf, not the student
    const svc = new ConsentService({ sql: h.sql, authorize })

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc.grantConsent(f.student, 'platform_participation', ctx)
      } catch (e) {
        caught = e
      }
    })

    expect(caught).toBeInstanceOf(Forbidden)
    expect(JSON.stringify(caught)).not.toMatch(/out_of_scope/)
    const denied = await h.sql`
      select detail from audit_entry
      where action = 'permission.denied' and actor_account_id = ${strangerId}
    `
    expect(denied).toHaveLength(1)
    expect(denied[0]!.detail).toMatchObject({ capability: 'consent.grant', reason: 'out_of_scope' })
    expect(await consentRows(f.student, 'platform_participation')).toHaveLength(0)
  })
})
