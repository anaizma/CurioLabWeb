// -------------------------------------------------------------------------
// MaturationService tests (Milestone 4) — the coming-of-age flow (Flow D) and
// the 16+ credential privatization. Embedded Postgres, synthetic data only.
//
//   - addEmail: an 18+ student adds their email, minor -> maturation_pending;
//     guardian READ persists (the edge is still verified).
//   - confirmMaturation: chapter_director confirms, maturation_pending ->
//     self_managed AND the guardianship edge `verified -> lapsed`; afterwards the
//     guardian's view_child_record no longer resolves (the edge is not verified).
//   - sweepMaturationBackstop: 90 days past 18 (unmatured) lapses the edge; a
//     30-days-past account is untouched; a self_managed account is untouched; a
//     notice fires 30 days prior (birthday + 60 days).
//   - reissueSetup: an adult ex-student with no active membership gets a fresh
//     setup token + an audited recovery; rejected against an active membership;
//     account.recover denied to a non-director.
//   - privatizeCredential: 16+ with a non-guardian chapter-adult witness sets
//     credential_owner = self_private; rejected under 16, without a witness, or
//     when the witness is a guardian of that student.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Forbidden, authorize, withRequest } from '@curiolab/runtime'
import { can, type AuthContext } from '@curiolab/core'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import {
  MaturationService,
  passwordResetRoute,
  MaturationNotSelfError,
  MaturationAgeError,
  IllegalMaturationTransitionError,
  ReissueActiveMembershipError,
  CredentialWitnessRequiredError,
  CredentialWitnessInvalidError,
  CredentialWitnessIsGuardianError,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

// ---------------------------------------------------------------------------
// Context builders.
// ---------------------------------------------------------------------------
function directorCtx(director: string, chapter: string) {
  return baseCtx(director, new Date(), [mem('chapter_director', chapter)])
}

/** The maturing student's own authenticated session at `age`. */
function studentCtx(studentId: string, chapter: string, age: number): AuthContext {
  const c = baseCtx(studentId, new Date(), [mem('student', chapter)])
  return {
    ...c,
    account: {
      id: studentId,
      status: 'active',
      age,
      maturation_state: 'minor',
      credential_owner: 'guardian_provisioned',
    },
  }
}

/** A guardian context whose verified children are `childIds`. */
function guardianCtx(guardianId: string, childIds: string[]): AuthContext {
  return { ...baseCtx(guardianId, new Date(), []), guardianOf: childIds }
}

// A verified guardian's child record resource (used for the `can` read assertions).
function childRecord(studentId: string, chapter: string, age: number) {
  return {
    subjectAccountId: studentId,
    subjectAge: age,
    subjectIsMinor: age < 18,
    chapter_id: chapter,
    subjectPodId: null,
  }
}

// ---------------------------------------------------------------------------
// Seed a maturing student: a username-only student account at `dateOfBirth`, an
// enrollment record binding them to a chapter, a guardian account, and a
// verified guardianship edge.
// ---------------------------------------------------------------------------
interface SeedOptions {
  dateOfBirth: string
  maturationState?: 'minor' | 'maturation_pending' | 'self_managed'
  credentialOwner?: 'guardian_provisioned' | 'self_private'
  edgeStatus?: 'verified' | 'lapsed'
}
interface Seed {
  chapter: string
  term: string
  director: string
  student: string
  guardian: string
  enrollmentId: string
  guardianshipId: string
}

async function seedMaturingStudent(opts: SeedOptions): Promise<Seed> {
  const chapter = await makeChapter(h.sql)
  const [term] = await h.sql`
    insert into term (chapter_id, name, starts_on, ends_on)
    values (${chapter}, 'Fall Term 2099', '2099-09-01', '2099-12-15') returning id
  `
  const director = await makeAdult(h.sql)

  // The student: username identity, guardian_provisioned, enrollment_record
  // provenance (the decision-4 shape), at the given DOB and maturation state.
  const [s] = await h.sql`
    insert into account (
      email, username, legal_name, display_name, date_of_birth,
      dob_provenance, dob_source_ref, credential_owner, status, maturation_state
    ) values (
      ${null}, ${`student-${randomUUID().slice(0, 8)}`}, 'Minor Testchild', 'Minor T.',
      ${opts.dateOfBirth}, 'enrollment_record', ${randomUUID()},
      ${opts.credentialOwner ?? 'guardian_provisioned'}, 'active', ${opts.maturationState ?? 'minor'}
    ) returning id
  `
  const student = s!.id as string

  const guardianEmail = `parent-${randomUUID().slice(0, 8)}@example.test`
  const [app] = await h.sql`
    insert into application (kind, chapter_id, status, applicant_name, applicant_contact_email, guardian_name, guardian_email)
    values ('student', ${chapter}, 'accepted', 'Minor Testchild', ${guardianEmail}, 'Parent Testperson', ${guardianEmail}) returning id
  `
  const [enr] = await h.sql`
    insert into enrollment_record (application_id, student_account_id, chapter_id, term_id, signed_form_ref, guardian_name_on_form, created_by)
    values (${app!.id}, ${student}, ${chapter}, ${term!.id}, ${randomUUID()}, 'Parent Testperson', ${director}) returning id
  `
  const [g] = await h.sql`
    insert into account (email, username, legal_name, display_name, date_of_birth, dob_provenance, credential_owner, status, maturation_state)
    values (${guardianEmail}, ${null}, 'Parent Testperson', 'Parent T.', '1980-01-01', 'self_reported', 'self_private', 'active', 'self_managed') returning id
  `
  const guardian = g!.id as string
  const [edge] = await h.sql`
    insert into guardianship (guardian_account_id, student_account_id, relationship, status, verification_method, verified_by, source_ref, verified_at)
    values (${guardian}, ${student}, 'guardian', ${opts.edgeStatus ?? 'verified'}, 'signed_form_match', ${director}, ${randomUUID()}, now()) returning id
  `

  return {
    chapter,
    term: term!.id as string,
    director,
    student,
    guardian,
    enrollmentId: enr!.id as string,
    guardianshipId: edge!.id as string,
  }
}

async function accountRow(id: string) {
  const [row] = await h.sql`select email, username, maturation_state, credential_owner, status from account where id = ${id}`
  return row!
}
async function edgeStatus(id: string): Promise<string> {
  const [row] = await h.sql`select status from guardianship where id = ${id}`
  return row!.status as string
}

function svc() {
  return new MaturationService({ sql: h.sql, authorize })
}

// ===========================================================================
describe('addEmail (Flow D step 2: an 18+ student adds an email)', () => {
  test('minor -> maturation_pending, sets the email (username cleared), guardian READ still resolves', async () => {
    const f = await seedMaturingStudent({ dateOfBirth: '2005-01-01' }) // 18+
    const email = `grown-${randomUUID().slice(0, 8)}@example.test`

    await svc().addEmail(f.student, email, studentCtx(f.student, f.chapter, 18))

    const a = await accountRow(f.student)
    expect(a.maturation_state).toBe('maturation_pending')
    expect((a.email as string).toLowerCase()).toBe(email.toLowerCase())
    expect(a.username).toBeNull()

    // The edge is NOT lapsed yet; guardian read persists through this state.
    expect(await edgeStatus(f.guardianshipId)).toBe('verified')
    const gctx = guardianCtx(f.guardian, [f.student])
    expect(can(gctx, 'guardian.view_child_record', childRecord(f.student, f.chapter, 18)).allowed).toBe(true)
  })

  test('a student under 18 is rejected (MaturationAgeError), nothing changes', async () => {
    const f = await seedMaturingStudent({ dateOfBirth: '2012-01-01' })
    let caught: unknown
    try {
      await svc().addEmail(f.student, 'kid@example.test', studentCtx(f.student, f.chapter, 13))
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(MaturationAgeError)
    expect((await accountRow(f.student)).maturation_state).toBe('minor')
  })

  test('a caller who is not the account owner is rejected (MaturationNotSelfError)', async () => {
    const f = await seedMaturingStudent({ dateOfBirth: '2005-01-01' })
    const other = await makeAdult(h.sql)
    let caught: unknown
    try {
      await svc().addEmail(f.student, 'x@example.test', studentCtx(other, f.chapter, 40))
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(MaturationNotSelfError)
    expect((await accountRow(f.student)).maturation_state).toBe('minor')
  })

  test('an account already past minor is an illegal transition', async () => {
    const f = await seedMaturingStudent({ dateOfBirth: '2005-01-01', maturationState: 'maturation_pending' })
    let caught: unknown
    try {
      await svc().addEmail(f.student, 'x@example.test', studentCtx(f.student, f.chapter, 19))
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(IllegalMaturationTransitionError)
  })
})

// ===========================================================================
describe('confirmMaturation (Flow D step 3: the Chapter Director confirms)', () => {
  test('maturation_pending -> self_managed AND the edge verified -> lapsed; guardian read then denies; audited', async () => {
    const f = await seedMaturingStudent({ dateOfBirth: '2005-01-01', maturationState: 'maturation_pending' })
    const ctx = directorCtx(f.director, f.chapter)

    await withRequest(async () => {
      await svc().confirmMaturation(f.student, ctx)
    })

    expect((await accountRow(f.student)).maturation_state).toBe('self_managed')
    expect(await edgeStatus(f.guardianshipId)).toBe('lapsed')

    // The guardian's rebuilt context no longer carries the (now lapsed) child; the
    // read denies out_of_scope (04-state-machines: guardian read ends at the lapse).
    const gctx = guardianCtx(f.guardian, [])
    const d = can(gctx, 'guardian.view_child_record', childRecord(f.student, f.chapter, 18))
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.reason).toBe('out_of_scope')

    const [audit] = await h.sql`
      select action from audit_entry where action = 'maturation.confirm' and subject_id = ${f.student}
    `
    expect(audit).toBeDefined()
  })

  test('a non-director is denied through authorize: Forbidden, one permission.denied row, nothing flips', async () => {
    const f = await seedMaturingStudent({ dateOfBirth: '2005-01-01', maturationState: 'maturation_pending' })
    const leadId = await makeAdult(h.sql)
    const ctx = baseCtx(leadId, new Date(), [mem('lead_instructor', f.chapter)])

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().confirmMaturation(f.student, ctx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)

    const denied = await h.sql`
      select detail from audit_entry where action = 'permission.denied' and actor_account_id = ${leadId}
    `
    expect(denied).toHaveLength(1)
    expect(denied[0]!.detail).toMatchObject({ capability: 'maturation.confirm', reason: 'role_not_permitted' })

    expect((await accountRow(f.student)).maturation_state).toBe('maturation_pending')
    expect(await edgeStatus(f.guardianshipId)).toBe('verified')
  })

  test('confirming an account that is still a minor is an illegal transition', async () => {
    const f = await seedMaturingStudent({ dateOfBirth: '2005-01-01', maturationState: 'minor' })
    const ctx = directorCtx(f.director, f.chapter)
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().confirmMaturation(f.student, ctx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(IllegalMaturationTransitionError)
    expect(await edgeStatus(f.guardianshipId)).toBe('verified')
  })
})

// ===========================================================================
describe('sweepMaturationBackstop (the 90-day backstop with a 30-day-prior notice)', () => {
  const now = new Date('2026-07-01T12:00:00Z')
  // 18th birthday = DOB + 18y. To be N days past 18 at `now`, DOB = now - N days - 18y.
  const DOB_91_PAST = '2008-04-01' // 18th birthday 2026-04-01 = 91 days before now
  const DOB_65_PAST = '2008-04-27' // 65 days before now (in the 60..90 notice window)
  const DOB_30_PAST = '2008-06-01' // 30 days before now (not yet at the 90-day lapse)

  test('an account 91 days past 18 and not self_managed has its verified edge lapsed', async () => {
    const f = await seedMaturingStudent({ dateOfBirth: DOB_91_PAST, maturationState: 'maturation_pending' })
    const notified: string[] = []
    const r = await svc().sweepMaturationBackstop({ sql: h.sql, notify: (n) => { notified.push(n.accountId) } }, now)
    expect(r.lapsed).toContain(f.student)
    expect(await edgeStatus(f.guardianshipId)).toBe('lapsed')
    expect(notified).not.toContain(f.student)
  })

  test('an account only 30 days past 18 is NOT lapsed', async () => {
    const f = await seedMaturingStudent({ dateOfBirth: DOB_30_PAST, maturationState: 'minor' })
    const r = await svc().sweepMaturationBackstop({ sql: h.sql }, now)
    expect(r.lapsed).not.toContain(f.student)
    expect(await edgeStatus(f.guardianshipId)).toBe('verified')
  })

  test('a self_managed account is untouched (already matured)', async () => {
    const f = await seedMaturingStudent({ dateOfBirth: DOB_91_PAST, maturationState: 'self_managed' })
    const r = await svc().sweepMaturationBackstop({ sql: h.sql }, now)
    expect(r.lapsed).not.toContain(f.student)
    expect(await edgeStatus(f.guardianshipId)).toBe('verified')
  })

  test('an account 30 days before its lapse (birthday + 60 days) fires the notice, not a lapse', async () => {
    const f = await seedMaturingStudent({ dateOfBirth: DOB_65_PAST, maturationState: 'minor' })
    const notified: string[] = []
    const r = await svc().sweepMaturationBackstop({ sql: h.sql, notify: (n) => { notified.push(n.accountId) } }, now)
    expect(notified).toContain(f.student)
    expect(r.lapsed).not.toContain(f.student)
    expect(await edgeStatus(f.guardianshipId)).toBe('verified')
  })
})

// ===========================================================================
describe('reissueSetup (Flow D step 4: account.recover for a locked-out adult ex-student)', () => {
  test('an adult ex-student with no active membership gets a fresh token and an audited recovery', async () => {
    const f = await seedMaturingStudent({ dateOfBirth: '2004-01-01' })
    // A former student: an offboarded membership, none active.
    await h.sql`insert into membership (account_id, chapter_id, role, status) values (${f.student}, ${f.chapter}, 'student', 'offboarded')`
    const ctx = directorCtx(f.director, f.chapter)

    let token!: string
    await withRequest(async () => {
      const r = await svc().reissueSetup(f.student, ctx)
      token = r.token
    })
    expect(token).toBeTruthy()

    const [audit] = await h.sql`
      select action, actor_account_id from audit_entry where action = 'account.recover' and subject_id = ${f.student}
    `
    expect(audit).toBeDefined()
    expect(audit!.actor_account_id).toBe(f.director)
  })

  test('is rejected when the account has an active membership', async () => {
    const f = await seedMaturingStudent({ dateOfBirth: '2004-01-01' })
    await h.sql`insert into membership (account_id, chapter_id, role, status) values (${f.student}, ${f.chapter}, 'student', 'active')`
    const ctx = directorCtx(f.director, f.chapter)
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().reissueSetup(f.student, ctx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(ReissueActiveMembershipError)
  })

  test('account.recover is denied to a non-director (Forbidden, one permission.denied row)', async () => {
    const f = await seedMaturingStudent({ dateOfBirth: '2004-01-01' })
    const leadId = await makeAdult(h.sql)
    const ctx = baseCtx(leadId, new Date(), [mem('lead_instructor', f.chapter)])
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().reissueSetup(f.student, ctx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
    const denied = await h.sql`
      select detail from audit_entry where action = 'permission.denied' and actor_account_id = ${leadId}
    `
    expect(denied).toHaveLength(1)
    expect(denied[0]!.detail).toMatchObject({ capability: 'account.recover', reason: 'role_not_permitted' })
  })
})

// ===========================================================================
describe('privatizeCredential (the 16+ self_private transition)', () => {
  // A non-guardian chapter adult (teaching membership) who may witness.
  async function makeWitness(chapter: string): Promise<string> {
    const w = await makeAdult(h.sql)
    await h.sql`insert into membership (account_id, chapter_id, role, status) values (${w}, ${chapter}, 'lead_instructor', 'active')`
    return w
  }

  test('16+ with a non-guardian chapter-adult witness sets credential_owner = self_private; audited', async () => {
    const f = await seedMaturingStudent({ dateOfBirth: '2009-01-01' }) // 16/17
    const witness = await makeWitness(f.chapter)

    await svc().privatizeCredential(f.student, studentCtx(f.student, f.chapter, 16), { witnessedBy: witness })

    expect((await accountRow(f.student)).credential_owner).toBe('self_private')
    const [audit] = await h.sql`
      select detail from audit_entry where action = 'credential.privatized' and subject_id = ${f.student}
    `
    expect(audit).toBeDefined()
    expect(audit!.detail).toMatchObject({ witnessedBy: witness, passwordResetRoute: 'chapter_director' })
  })

  test('a student under 16 cannot privatize (MaturationAgeError)', async () => {
    const f = await seedMaturingStudent({ dateOfBirth: '2012-01-01' })
    const witness = await makeWitness(f.chapter)
    let caught: unknown
    try {
      await svc().privatizeCredential(f.student, studentCtx(f.student, f.chapter, 15), { witnessedBy: witness })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(MaturationAgeError)
    expect((await accountRow(f.student)).credential_owner).toBe('guardian_provisioned')
  })

  test('a transition witnessed by a guardian of that student is rejected', async () => {
    const f = await seedMaturingStudent({ dateOfBirth: '2009-01-01' })
    let caught: unknown
    try {
      // The guardian holds the child's credentials — precisely who may NOT witness.
      await svc().privatizeCredential(f.student, studentCtx(f.student, f.chapter, 16), { witnessedBy: f.guardian })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(CredentialWitnessIsGuardianError)
    expect((await accountRow(f.student)).credential_owner).toBe('guardian_provisioned')
  })

  test('a transition without a witness is rejected', async () => {
    const f = await seedMaturingStudent({ dateOfBirth: '2009-01-01' })
    let caught: unknown
    try {
      await svc().privatizeCredential(f.student, studentCtx(f.student, f.chapter, 16), { witnessedBy: null })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(CredentialWitnessRequiredError)
    expect((await accountRow(f.student)).credential_owner).toBe('guardian_provisioned')
  })

  test('a witness who is not an active chapter adult is rejected (CredentialWitnessInvalidError)', async () => {
    const f = await seedMaturingStudent({ dateOfBirth: '2009-01-01' })
    const stranger = await makeAdult(h.sql) // no membership in the chapter
    let caught: unknown
    try {
      await svc().privatizeCredential(f.student, studentCtx(f.student, f.chapter, 16), { witnessedBy: stranger })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(CredentialWitnessInvalidError)
  })
})

// ===========================================================================
describe('passwordResetRoute (the post-privatization routing decision)', () => {
  test('a self_private credential routes reset to the chapter_director; guardian_provisioned to the guardian', () => {
    expect(passwordResetRoute('self_private')).toBe('chapter_director')
    expect(passwordResetRoute('guardian_provisioned')).toBe('guardian')
  })
})
