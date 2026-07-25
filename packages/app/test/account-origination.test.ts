// -------------------------------------------------------------------------
// ACCOUNT-ORIGINATION CHAIN — the WHOLE real chain, end to end, asserting each
// hop, creating nothing by hand that production should create (NO synthetic
// seeding of invites/accounts/memberships — synthetic seeding is exactly what hid
// the gaps this suite closes). Embedded Postgres.
//
// The family chain (Flow A/B):
//   1. accepted application -> EnrollmentService.create -> an inert student SHELL
//      (pending, system username, no password, dob provenance) + a PENDING student
//      membership + enrollment.student_account_id set + the form-sourced consents;
//   2. director issues a GUARDIAN invite (real enrollmentRecordId);
//   3. guardian accepts -> pending guardian account + pending guardianship edge;
//   4. director verifies the guardianship -> verified;
//   5. guardian grants participation, then MINTS the student setup credential; the
//      child REDEEMS it -> the student account now has a password, still pending;
//   6. director activates the student membership -> membership + account active,
//      Explorer tier written.
//
// Guardian-before-student (the COPPA ordering invariant) is asserted at every hop:
// the student cannot log in / has no active membership before step 6, and the
// setup mint REFUSES before the guardianship is verified and before participation
// consent is on file.
//
// Plus the adult chain (§2): a mentor/staff/director invite -> accept -> an ACTIVE
// membership (real, not seeded); a guardian accept creates NO membership.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { AuthContext } from '@curiolab/core'
import { authorize, hashToken, verifyPassword, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeChapter } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import {
  ConsentService,
  EnrollmentService,
  GuardianshipService,
  InMemoryStorageAdapter,
  InviteService,
  MembershipActivationService,
  StudentSetupService,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

function directorCtx(director: string, chapter: string): AuthContext {
  return baseCtx(director, new Date(), [mem('chapter_director', chapter)])
}
function adminCtx(admin: string, chapter: string): AuthContext {
  return baseCtx(admin, new Date(), [mem('platform_admin', chapter)])
}
/** A guardian ctx whose verified edges (guardianOf) are exactly `children`. */
function guardianCtx(guardianId: string, children: string[]): AuthContext {
  return { ...baseCtx(guardianId, new Date()), guardianOf: children }
}

async function makeStaffAccount(legalName = 'Director Testperson'): Promise<string> {
  const [row] = await h.sql`
    insert into account (
      email, legal_name, display_name, date_of_birth, dob_provenance,
      credential_owner, status, maturation_state
    ) values (
      ${`staff-${randomUUID().slice(0, 8)}@example.test`}, ${legalName}, 'Staff T.',
      '1980-01-01', 'staff_entered', 'self_private', 'active', 'self_managed'
    ) returning id
  `
  return row!.id as string
}

// A chapter + term + director + admin + an ACCEPTED student application. The
// application's guardian_email is the email the guardian will accept with (the
// guardian-invite binding requires application.guardian_email == target_email),
// and guardian_name matches guardianNameOnForm (the name-match at verification).
async function chapterFixture() {
  const chapter = await makeChapter(h.sql)
  const [term] = await h.sql`
    insert into term (chapter_id, name, starts_on, ends_on)
    values (${chapter}, 'Fall Term 2099', '2099-09-01', '2099-12-15') returning id
  `
  const director = await makeStaffAccount()
  const admin = await makeStaffAccount()
  const guardianEmail = `parent-${randomUUID().slice(0, 8)}@example.test`
  const guardianName = 'Parent Testperson'
  const [app] = await h.sql`
    insert into application (
      kind, chapter_id, status, applicant_name, applicant_contact_email,
      guardian_name, guardian_email, created_at
    ) values (
      'student', ${chapter}, 'accepted', 'Minor Testchild', ${guardianEmail},
      ${guardianName}, ${guardianEmail}, '2013-01-01T00:00:00Z'
    ) returning id
  `
  return {
    chapter,
    term: term!.id as string,
    director,
    admin,
    guardianEmail,
    guardianName,
    applicationId: app!.id as string,
  }
}

const services = () => ({
  enroll: new EnrollmentService({ sql: h.sql, authorize, storage: new InMemoryStorageAdapter() }),
  invites: new InviteService({ sql: h.sql, authorize }),
  guardianships: new GuardianshipService({ sql: h.sql, authorize }),
  consents: new ConsentService({ sql: h.sql, authorize }),
  setup: new StudentSetupService({ sql: h.sql, authorize }),
  activation: new MembershipActivationService({ sql: h.sql, authorize }),
})

// ===========================================================================
describe('the full family origination chain (real, no synthetic seeding)', () => {
  test('application -> enrollment shell -> guardian accept -> verify -> setup mint+redeem -> activate', async () => {
    const f = await chapterFixture()
    const s = services()
    const dctx = directorCtx(f.director, f.chapter)

    // --- Hop 1: enrollment creates the inert shell + pending membership --------
    let enr!: Awaited<ReturnType<EnrollmentService['createEnrollment']>>
    await withRequest(async () => {
      enr = await s.enroll.createEnrollment(
        {
          applicationId: f.applicationId,
          chapterId: f.chapter,
          termId: f.term,
          dateOfBirth: '2014-04-04',
          guardianNameOnForm: f.guardianName,
          signatureDate: new Date('2014-05-05T00:00:00Z'),
          signedForm: { body: 'synthetic-signed-scan-bytes', contentType: 'application/pdf' },
        },
        dctx,
      )
    })
    const studentId = enr.studentAccountId!
    const membershipId = enr.studentMembershipId!
    expect(studentId).toBeTruthy()

    const [shell] = await h.sql`
      select status, username, email, password_hash, dob_provenance, dob_source_ref
      from account where id = ${studentId}
    `
    expect(shell!.status).toBe('pending')
    expect(shell!.username).toBeTruthy()
    expect(shell!.email).toBeNull()
    expect(shell!.password_hash).toBeNull() // login must fail until setup
    expect(shell!.dob_provenance).toBe('enrollment_record')
    expect(shell!.dob_source_ref).toBe(enr.enrollmentRecordId)
    // The enrollment is linked; the pending membership exists; no active membership.
    const [er] = await h.sql`select student_account_id from enrollment_record where id = ${enr.enrollmentRecordId}`
    expect(er!.student_account_id).toBe(studentId)
    const [pm] = await h.sql`select role, status from membership where id = ${membershipId}`
    expect(pm!.role).toBe('student')
    expect(pm!.status).toBe('pending')
    expect(await activeMemberships(studentId)).toBe(0)

    // --- Hop 2: director issues a GUARDIAN invite (real enrollmentRecordId) ----
    let ginvite!: Awaited<ReturnType<InviteService['issueInvite']>>
    await withRequest(async () => {
      ginvite = await s.invites.issueInvite(
        {
          kind: 'guardian',
          chapterId: f.chapter,
          targetEmail: f.guardianEmail,
          enrollmentRecordId: enr.enrollmentRecordId,
        },
        dctx,
      )
    })
    expect(ginvite.token).toBeTruthy()

    // GUARDIAN-BEFORE-STUDENT: with only a PENDING (or no) guardianship, the setup
    // mint is REFUSED. Even if the guardian scope somehow matched, the service's
    // verified-edge floor holds.
    await expect(
      s.setup.provisionSetupCredential(studentId, guardianCtx(randomUUID(), [studentId])),
    ).rejects.toThrow()

    // --- Hop 3: guardian accepts -> pending account + pending edge -------------
    const acc = await s.invites.acceptInvite(ginvite.token, {
      email: f.guardianEmail,
      password: 'correct horse battery staple',
      legalName: f.guardianName,
      displayName: 'Parent T.',
      dateOfBirth: '1985-03-04',
    })
    const guardianId = acc.accountId
    expect(acc.guardianshipId).toBeTruthy()
    const [gacct] = await h.sql`select status from account where id = ${guardianId}`
    expect(gacct!.status).toBe('pending')
    const [edge0] = await h.sql`select status from guardianship where id = ${acc.guardianshipId}`
    expect(edge0!.status).toBe('pending')
    // The guardian accept creates NO membership (only the pending edge).
    expect(await memberships(guardianId)).toBe(0)

    // Still refused: the edge exists but is only PENDING (not verified).
    await expect(
      s.setup.provisionSetupCredential(studentId, guardianCtx(guardianId, [studentId])),
    ).rejects.toThrow()

    // --- Hop 4: director verifies the guardianship -> verified -----------------
    let verifyRes!: Awaited<ReturnType<GuardianshipService['verifyGuardianship']>>
    await withRequest(async () => {
      verifyRes = await s.guardianships.verifyGuardianship(acc.guardianshipId!, dctx)
    })
    expect(verifyRes.status).toBe('verified')
    expect(verifyRes.matched).toBe(true)

    // Verified, but STILL refused until participation consent is on file (§3 gate).
    await expect(
      s.setup.provisionSetupCredential(studentId, guardianCtx(guardianId, [studentId])),
    ).rejects.toThrow()

    // --- Hop 5a: guardian grants participation consent -------------------------
    await withRequest(async () => {
      await s.consents.grantConsent(studentId, 'platform_participation', guardianCtx(guardianId, [studentId]))
    })

    // --- Hop 5b: guardian MINTS the setup credential, child REDEEMS it ---------
    let mint!: Awaited<ReturnType<StudentSetupService['provisionSetupCredential']>>
    await withRequest(async () => {
      mint = await s.setup.provisionSetupCredential(studentId, guardianCtx(guardianId, [studentId]))
    })
    expect(mint.setupToken).toBeTruthy()
    expect(mint.route).toBe('guardian')
    expect(mint.guardianAccountId).toBe(guardianId)
    // The token is bound to the CHILD account (guardian-delivered), purpose minor_setup.
    const [tok] = await h.sql`
      select account_id, purpose from credential_token where token_hash = ${hashToken(mint.setupToken)}
    `
    expect(tok!.account_id).toBe(studentId)
    expect(tok!.purpose).toBe('minor_setup')

    // Before redemption the child cannot log in (still no password).
    const [preRedeem] = await h.sql`select password_hash, status from account where id = ${studentId}`
    expect(preRedeem!.password_hash).toBeNull()

    const redeemed = await s.setup.redeemSetupCredential(mint.setupToken, 'hunter2 correct staple')
    expect(redeemed.accountId).toBe(studentId)
    // The child now has a password, KEEPS the system username, and STAYS pending.
    const [postRedeem] = await h.sql`select username, password_hash, status from account where id = ${studentId}`
    expect(await verifyPassword(postRedeem!.password_hash as string, 'hunter2 correct staple')).toBe(true)
    expect(postRedeem!.username).toBe(shell!.username) // unchanged system username
    expect(postRedeem!.status).toBe('pending') // no membership activated by setup
    expect(await activeMemberships(studentId)).toBe(0)
    // The token is single-use.
    await expect(
      s.setup.redeemSetupCredential(mint.setupToken, 'another password entirely'),
    ).rejects.toThrow()

    // --- Hop 6: director activates the student membership ----------------------
    let act!: Awaited<ReturnType<MembershipActivationService['activateStudent']>>
    await withRequest(async () => {
      act = await s.activation.activateStudent(membershipId, dctx)
    })
    expect(act.tier).toBe('explorer')
    const [finalM] = await h.sql`select status, current_tier from membership where id = ${membershipId}`
    expect(finalM!.status).toBe('active')
    expect(finalM!.current_tier).toBe('explorer')
    const [finalA] = await h.sql`select status from account where id = ${studentId}`
    expect(finalA!.status).toBe('active')
    expect(await activeMemberships(studentId)).toBe(1)
  })
})

// ===========================================================================
describe('the adult chain (§2): accept stands up an ACTIVE membership (real)', () => {
  const creds = (e: string) => ({
    email: e,
    password: 'correct horse battery staple',
    legalName: 'Adult Testperson',
    displayName: 'Adult T.',
    dateOfBirth: '1990-01-01',
  })

  test('mentor + staff (director-issued) and director (admin-issued) accept -> active memberships', async () => {
    const f = await chapterFixture()
    const s = services()

    for (const [kind, role, issuer] of [
      ['mentor', 'junior_mentor', 'director'],
      ['staff', 'comms_associate', 'director'],
      ['director', 'chapter_director', 'admin'],
    ] as const) {
      const targetEmail = `adult-${randomUUID().slice(0, 8)}@example.test`
      const ctx = issuer === 'admin' ? adminCtx(f.admin, f.chapter) : directorCtx(f.director, f.chapter)
      let inv!: Awaited<ReturnType<InviteService['issueInvite']>>
      await withRequest(async () => {
        inv = await s.invites.issueInvite({ kind, chapterId: f.chapter, targetEmail }, ctx)
      })
      const res = await s.invites.acceptInvite(inv.token, creds(targetEmail), {
        email: targetEmail,
        kind,
        chapter: f.chapter,
      })
      const [acct] = await h.sql`select status from account where id = ${res.accountId}`
      expect(acct!.status).toBe('active')
      const ms = await h.sql`select role, status from membership where account_id = ${res.accountId}`
      expect(ms).toHaveLength(1)
      expect(ms[0]!.role).toBe(role)
      expect(ms[0]!.status).toBe('active')
      expect(res.guardianshipId).toBeNull()
    }
  })
})

async function memberships(accountId: string): Promise<number> {
  const [r] = await h.sql`select count(*)::int as n from membership where account_id = ${accountId}`
  return r!.n as number
}
async function activeMemberships(accountId: string): Promise<number> {
  const [r] = await h.sql`
    select count(*)::int as n from membership where account_id = ${accountId} and status = 'active'
  `
  return r!.n as number
}
