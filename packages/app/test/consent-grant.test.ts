// -------------------------------------------------------------------------
// ConsentGrantService tests (admin/director backend §5) — the append-only,
// per-practice grant ledger. Embedded Postgres, synthetic data only,
// deterministic clocks. Covers every rule:
//   * grant capture writes append-only rows + a ledger row; a renewal is a new row;
//   * Rule 2 (under-13 public_publication): a click is refused, a strong method
//     without an artifact is refused, a strong method + artifact is accepted; a
//     13+ click is accepted;
//   * Rule 5 (per-grant revocation): a revoke writes one revocation row for that
//     type only (others untouched); an enrollment-required type is refused; a
//     public_publication revoke cascades (unpublish/withhold public items);
//   * the guardian reads are scoped to verified children and leak no raw PII;
//   * the notify-and-object job releases an un-objected item after N days and
//     withholds an objected one (idempotent);
//   * the 18th-birthday transfer lapses guardian grants and the adult self-grants.
// The publishing-gate behavior (flag on/off) is exercised in the project /
// newsletter / profile suites; here we test the mechanism.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import type { AuthContext } from '@curiolab/core'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Forbidden, authorize, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMinor } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import {
  ConsentGrantService,
  GrantNotActiveError,
  GrantRevocationEndsEnrollmentError,
  GrantStrongMethodRequiredError,
  hasActiveGrant,
  lapseGuardianGrantsOnMaturation,
  nominatePublicationHold,
  runPublicationHolds,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

interface Setup {
  chapter: string
  term: string
  director: string
  student: string
  guardian: string
  enrollmentId: string
}

async function setup(studentDob = '2015-06-01'): Promise<Setup> {
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

function guardianCtx(guardianId: string, children: string[]): AuthContext {
  return { ...baseCtx(guardianId, new Date()), guardianOf: children }
}

function selfStudentCtx(studentId: string, chapter: string, age: number): AuthContext {
  const b = baseCtx(studentId, new Date(), [mem('student', chapter)])
  return { ...b, account: { ...b.account, age } }
}

async function grantRows(subject: string, grantType: string) {
  return h.sql`
    select method, revoked_at, expires_at, guardian_account_id from consent_grant
    where subject_student_account_id = ${subject} and grant_type = ${grantType}
    order by seq asc
  `
}
async function currentActive(subject: string, grantType: string): Promise<boolean | undefined> {
  const [row] = await h.sql`
    select active from consent_grant_current
    where subject_student_account_id = ${subject} and grant_type = ${grantType}
  `
  return row?.active as boolean | undefined
}
async function ledgerEvents(subject: string): Promise<string[]> {
  const rows = await h.sql`
    select event from access_ledger where subject_account_id = ${subject} order by at asc
  `
  return rows.map((r) => r.event as string)
}

// ---------------------------------------------------------------------------
describe('grant capture (append-only) + ledger', () => {
  test('a guardian captures platform_account; current active, one row, ledger written', async () => {
    const f = await setup()
    const ctx = guardianCtx(f.guardian, [f.student])
    const svc = new ConsentGrantService({ sql: h.sql, authorize })
    await withRequest(async () => {
      await svc.captureGrant(f.student, 'platform_account', ctx, { method: 'click' })
    })
    expect(await currentActive(f.student, 'platform_account')).toBe(true)
    const rows = await grantRows(f.student, 'platform_account')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.guardian_account_id).toBe(f.guardian)
    expect(rows[0]!.expires_at).not.toBeNull() // per-term clock
    expect(await ledgerEvents(f.student)).toContain('grant.captured')
  })

  test('a second capture of the same type is a renewal (a NEW row, never a mutation)', async () => {
    const f = await setup()
    const ctx = guardianCtx(f.guardian, [f.student])
    const svc = new ConsentGrantService({ sql: h.sql, authorize })
    await withRequest(async () => {
      await svc.captureGrant(f.student, 'platform_account', ctx, { method: 'click' })
      const r = await svc.captureGrant(f.student, 'platform_account', ctx, { method: 'click' })
      expect(r.renewal).toBe(true)
    })
    expect(await grantRows(f.student, 'platform_account')).toHaveLength(2)
    expect(await ledgerEvents(f.student)).toContain('grant.renewed')
  })

  test('a stranger is denied with a reason-less Forbidden', async () => {
    const f = await setup()
    const stranger = guardianCtx(f.guardian, []) // no guardianOf
    const svc = new ConsentGrantService({ sql: h.sql, authorize })
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc.captureGrant(f.student, 'platform_account', stranger, { method: 'click' })
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
    expect(await grantRows(f.student, 'platform_account')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
describe('Rule 2: strong verification for under-13 public_publication', () => {
  test('a click for an under-13 subject is REFUSED and nothing persists', async () => {
    const f = await setup('2016-01-01') // ~10y
    const ctx = guardianCtx(f.guardian, [f.student])
    const svc = new ConsentGrantService({ sql: h.sql, authorize })
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc.captureGrant(f.student, 'public_publication', ctx, { method: 'click' })
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(GrantStrongMethodRequiredError)
    expect((caught as GrantStrongMethodRequiredError).reason).toBe('weak_method')
    expect(await grantRows(f.student, 'public_publication')).toHaveLength(0)
  })

  test('a strong method WITHOUT an artifact for an under-13 subject is REFUSED', async () => {
    const f = await setup('2016-01-01')
    const ctx = guardianCtx(f.guardian, [f.student])
    const svc = new ConsentGrantService({ sql: h.sql, authorize })
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc.captureGrant(f.student, 'public_publication', ctx, { method: 'signed_form' })
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(GrantStrongMethodRequiredError)
    expect((caught as GrantStrongMethodRequiredError).reason).toBe('artifact_missing')
  })

  test('a strong method WITH an artifact for an under-13 subject is accepted', async () => {
    const f = await setup('2016-01-01')
    const ctx = guardianCtx(f.guardian, [f.student])
    const svc = new ConsentGrantService({ sql: h.sql, authorize })
    await withRequest(async () => {
      await svc.captureGrant(f.student, 'public_publication', ctx, {
        method: 'signed_form',
        evidenceArtifactRef: 'artifact://signed.pdf',
      })
    })
    expect(await currentActive(f.student, 'public_publication')).toBe(true)
    const rows = await grantRows(f.student, 'public_publication')
    expect(rows[0]!.method).toBe('signed_form')
  })

  test('a click for a 13+ subject is accepted', async () => {
    const f = await setup('2010-01-01') // ~16y
    const ctx = guardianCtx(f.guardian, [f.student])
    const svc = new ConsentGrantService({ sql: h.sql, authorize })
    await withRequest(async () => {
      await svc.captureGrant(f.student, 'public_publication', ctx, { method: 'click' })
    })
    expect(await currentActive(f.student, 'public_publication')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
describe('Rule 5: per-grant revocation', () => {
  test('revoking platform_account writes a revocation row and does NOT touch other grants', async () => {
    const f = await setup()
    const ctx = guardianCtx(f.guardian, [f.student])
    const svc = new ConsentGrantService({ sql: h.sql, authorize })
    await withRequest(async () => {
      await svc.captureGrant(f.student, 'platform_account', ctx, { method: 'click' })
      await svc.captureGrant(f.student, 'verification_link_sharing', ctx, { method: 'click' })
      await svc.revokeGrant(f.student, 'platform_account', ctx)
    })
    expect(await currentActive(f.student, 'platform_account')).toBe(false)
    expect(await currentActive(f.student, 'verification_link_sharing')).toBe(true)
    expect(await grantRows(f.student, 'platform_account')).toHaveLength(2)
    expect(await ledgerEvents(f.student)).toContain('grant.revoked')
  })

  test('revoking an enrollment-required grant is REFUSED (routed to enrollment path)', async () => {
    const f = await setup()
    const ctx = guardianCtx(f.guardian, [f.student])
    const svc = new ConsentGrantService({ sql: h.sql, authorize })
    for (const t of ['program_participation', 'emergency_medical_pickup'] as const) {
      let caught: unknown
      await withRequest(async () => {
        try {
          await svc.revokeGrant(f.student, t, ctx)
        } catch (e) {
          caught = e
        }
      })
      expect(caught).toBeInstanceOf(GrantRevocationEndsEnrollmentError)
    }
  })

  test('revoking a grant with none active is refused (GrantNotActiveError)', async () => {
    const f = await setup()
    const ctx = guardianCtx(f.guardian, [f.student])
    const svc = new ConsentGrantService({ sql: h.sql, authorize })
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc.revokeGrant(f.student, 'platform_account', ctx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(GrantNotActiveError)
  })

  test('revoking public_publication CASCADES: unpublishes project + narrative', async () => {
    const f = await setup('2010-01-01')
    const ctx = guardianCtx(f.guardian, [f.student])
    const svc = new ConsentGrantService({ sql: h.sql, authorize })
    // A public_listed project + a published narrative for the student.
    const [mrow] = await h.sql`
      insert into membership (account_id, chapter_id, role, status, current_tier)
      values (${f.student}, ${f.chapter}, 'student', 'active', 'explorer') returning id
    `
    const [proj] = await h.sql`
      insert into project (chapter_id, owner_membership_id, title, status)
      values (${f.chapter}, ${mrow!.id}, 'My Rocket', 'public_listed') returning id
    `
    const [narr] = await h.sql`
      insert into profile_narrative (account_id, body, status)
      values (${f.student}, 'hello', 'published') returning id
    `
    await withRequest(async () => {
      await svc.captureGrant(f.student, 'public_publication', ctx, { method: 'click' })
      const r = await svc.revokeGrant(f.student, 'public_publication', ctx)
      expect(r.cascaded).toBe(true)
    })
    const [p] = await h.sql`select status from project where id = ${proj!.id}`
    const [n] = await h.sql`select status from profile_narrative where id = ${narr!.id}`
    expect(p!.status).toBe('verified')
    expect(n!.status).toBe('pending_review')
  })
})

// ---------------------------------------------------------------------------
describe('hasActiveGrant respects revocation and expiry', () => {
  test('an expired grant is not active', async () => {
    const f = await setup()
    await h.sql`
      insert into consent_grant (grant_type, subject_student_account_id, guardian_account_id, method, granted_at, expires_at)
      values ('platform_account', ${f.student}, ${f.guardian}, 'click', now() - interval '400 days', now() - interval '10 days')
    `
    expect(await hasActiveGrant(h.sql, f.student, 'platform_account', new Date())).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('guardian reads (scoped to verified children, display names only)', () => {
  test('listChildren returns the guardian verified children by display name', async () => {
    const f = await setup()
    const ctx = guardianCtx(f.guardian, [f.student])
    const svc = new ConsentGrantService({ sql: h.sql, authorize })
    const children = await withRequest(() => svc.listChildren(ctx))
    expect(children).toHaveLength(1)
    expect(children![0]!.childAccountId).toBe(f.student)
    expect(children![0]!.displayName).toBe('Minor T.')
  })

  test('a guardian with no verified child is denied out_of_scope', async () => {
    const f = await setup()
    const ctx = guardianCtx(f.guardian, [])
    const svc = new ConsentGrantService({ sql: h.sql, authorize })
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc.listChildren(ctx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
  })

  test('viewChildGrants reports all six types with status', async () => {
    const f = await setup()
    const ctx = guardianCtx(f.guardian, [f.student])
    const svc = new ConsentGrantService({ sql: h.sql, authorize })
    await withRequest(async () => {
      await svc.captureGrant(f.student, 'platform_account', ctx, { method: 'click' })
    })
    const grants = await withRequest(() => svc.viewChildGrants(f.student, ctx))
    expect(grants).toHaveLength(6)
    const platform = grants!.find((g) => g.grantType === 'platform_account')!
    expect(platform.status).toBe('active')
    const pub = grants!.find((g) => g.grantType === 'public_publication')!
    expect(pub.status).toBe('none')
  })

  test('viewChildPublicItems returns only public-surface items', async () => {
    const f = await setup()
    const ctx = guardianCtx(f.guardian, [f.student])
    const svc = new ConsentGrantService({ sql: h.sql, authorize })
    const [mrow] = await h.sql`
      insert into membership (account_id, chapter_id, role, status, current_tier)
      values (${f.student}, ${f.chapter}, 'student', 'active', 'explorer') returning id
    `
    await h.sql`insert into project (chapter_id, owner_membership_id, title, status) values (${f.chapter}, ${mrow!.id}, 'Public One', 'public_listed')`
    await h.sql`insert into project (chapter_id, owner_membership_id, title, status) values (${f.chapter}, ${mrow!.id}, 'Draft One', 'draft')`
    const items = await withRequest(() => svc.viewChildPublicItems(f.student, ctx))
    expect(items).toHaveLength(1)
    expect(items![0]!.title).toBe('Public One')
  })
})

// ---------------------------------------------------------------------------
describe('Rule 3: notify-and-object window (deterministic clock)', () => {
  test('an un-objected hold releases after the window; an objected one is withheld', async () => {
    const f = await setup()
    const ctx = guardianCtx(f.guardian, [f.student])
    const svc = new ConsentGrantService({ sql: h.sql, authorize })
    // Present-relative dates: the object write computes the child's age at `now`
    // (guardian write authority ends at 18), so a minor stays a minor here.
    const t0 = new Date('2026-01-01T00:00:00Z')

    // Two nominated items.
    const releaseItem = await nominatePublicationHold(
      { sql: h.sql },
      { itemType: 'project', itemRef: randomUUID(), subjectStudentAccountId: f.student, guardianAccountId: f.guardian },
      t0,
    )
    const objectItem = await nominatePublicationHold(
      { sql: h.sql },
      { itemType: 'narrative', itemRef: randomUUID(), subjectStudentAccountId: f.student, guardianAccountId: f.guardian },
      t0,
    )

    // Guardian objects to the second.
    await withRequest(() => svc.objectPublicationHold(objectItem.holdId, ctx, { now: new Date('2026-01-02T00:00:00Z') }))

    // Run the job AFTER the 5-day window.
    const after = new Date('2026-01-10T00:00:00Z')
    const published: string[] = []
    const result = await runPublicationHolds(
      { sql: h.sql, publish: (hh) => void published.push(hh.holdId) },
      after,
    )
    expect(result.released).toEqual([releaseItem.holdId])
    expect(result.withheld).toEqual([objectItem.holdId])
    expect(published).toEqual([releaseItem.holdId])
    expect(await ledgerEvents(f.student)).toContain('publication.released')
    expect(await ledgerEvents(f.student)).toContain('publication.objected')
  })

  test('a hold whose window has not elapsed is not released; the job is idempotent', async () => {
    const f = await setup()
    const t0 = new Date('2099-03-01T00:00:00Z')
    const hold = await nominatePublicationHold(
      { sql: h.sql },
      { itemType: 'project', itemRef: randomUUID(), subjectStudentAccountId: f.student },
      t0,
    )
    // Before the window: nothing.
    const early = await runPublicationHolds({ sql: h.sql }, new Date('2099-03-02T00:00:00Z'))
    expect(early.released).not.toContain(hold.holdId)
    // After: released once; a second run does not re-release.
    const first = await runPublicationHolds({ sql: h.sql }, new Date('2099-03-10T00:00:00Z'))
    expect(first.released).toContain(hold.holdId)
    const second = await runPublicationHolds({ sql: h.sql }, new Date('2099-03-11T00:00:00Z'))
    expect(second.released).not.toContain(hold.holdId)
  })
})

// ---------------------------------------------------------------------------
describe('Rule 4: 18th-birthday transfer (lapse guardian grants, adult self-grants)', () => {
  test('lapse writes revoking rows for guardian grants and records the transfer', async () => {
    const f = await setup('2010-01-01')
    const gctx = guardianCtx(f.guardian, [f.student])
    const svc = new ConsentGrantService({ sql: h.sql, authorize })
    await withRequest(async () => {
      await svc.captureGrant(f.student, 'public_publication', gctx, { method: 'click' })
      await svc.captureGrant(f.student, 'verification_link_sharing', gctx, { method: 'click' })
    })
    expect(await currentActive(f.student, 'public_publication')).toBe(true)

    const lapsed = await h.sql.begin((tx) =>
      lapseGuardianGrantsOnMaturation(tx, f.student, new Date()),
    )
    expect(lapsed).toEqual(expect.arrayContaining(['public_publication', 'verification_link_sharing']))
    expect(await currentActive(f.student, 'public_publication')).toBe(false)
    expect(await currentActive(f.student, 'verification_link_sharing')).toBe(false)
    expect(await ledgerEvents(f.student)).toContain('grant.transferred')

    // The now-adult re-confirms via the self-grant path.
    const selfCtx = selfStudentCtx(f.student, f.chapter, 18)
    await withRequest(async () => {
      await svc.selfGrant('public_publication', selfCtx, { method: 'click' })
    })
    expect(await currentActive(f.student, 'public_publication')).toBe(true)
    const rows = await grantRows(f.student, 'public_publication')
    // grant, lapse, self-grant = 3 rows; the self-grant carries guardian null.
    expect(rows[rows.length - 1]!.guardian_account_id).toBeNull()
  })
})
