// -------------------------------------------------------------------------
// STUDENT NOTIFICATION-EMAIL — the DARK, counsel-gated minor-contactability
// primitive + seam. Embedded Postgres, synthetic data only, deterministic clocks.
//
// Enabling this feature REVERSES the platform's standing "a student is not
// directly contactable" posture and makes a MINOR DIRECTLY CONTACTABLE, so the
// whole mechanism is built behind STUDENT_NOTIFICATION_EMAIL_ENABLED (default
// false) and is inert until counsel signs off. These tests exercise:
//   * grant capture: refuses under-13; a 13+ signed_form capture succeeds; a click
//     is refused; the grant is independently revocable;
//   * setting notification_email at setup redemption: refused when the flag is off /
//     no grant / under-13; succeeds when flag on + grant active + 13+; stored;
//   * the parent-CC RESOLVER seam (the core safety primitive): flag off => no
//     student email, all verified guardians returned; flag on + grant + 13+ + email
//     => the student email AND the guardian emails (parent-CC is structural);
//     revoked/expired/under-13/unset => no student email; multiple guardians => all;
//   * HIDDEN: no director/staff read leaks notification_email;
//   * DARK: with the flag off the whole feature is inert.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  authorize,
  generateSessionToken,
  hashToken,
  withRequest,
} from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMinor } from './helpers/fixtures.js'
import { baseCtx } from './helpers/ctx.js'
import type { AuthContext } from '@curiolab/core'
import {
  ConsentGrantService,
  StudentSetupService,
  OpsReadService,
  defaultConfig,
  resolveStudentNotificationTargets,
  StudentNotificationEmailAgeError,
  StudentNotificationEmailNotAuthorizedError,
  GrantSignedFormRequiredError,
  GrantNotActiveError,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

// A deterministic "now" for every age/expiry computation in this file.
const NOW = new Date('2026-07-25T12:00:00Z')
const flagOn = { ...defaultConfig, studentNotificationEmailEnabled: true }
const flagOff = { ...defaultConfig, studentNotificationEmailEnabled: false }

const DOB_15 = '2011-01-01' // 15 at NOW
const DOB_UNDER_13 = '2020-06-01' // ~6 at NOW

function guardianCtx(guardianId: string, children: string[]): AuthContext {
  return { ...baseCtx(guardianId, NOW), guardianOf: children }
}

/** Insert a VERIFIED guardianship edge (guardian -> student). */
async function verifiedGuardian(studentId: string, email: string): Promise<string> {
  const guardian = await makeAdult(h.sql, { email })
  await h.sql`
    insert into guardianship (
      guardian_account_id, student_account_id, relationship, status,
      verification_method, verified_by, source_ref, verified_at
    ) values (
      ${guardian}, ${studentId}, 'guardian', 'verified',
      'signed_form_match', ${guardian}, ${randomUUID()}, now()
    )
  `
  return guardian
}

/** A live minor_setup credential bound to a pending, password-less shell. */
async function setupToken(studentId: string): Promise<string> {
  await h.sql`update account set password_hash = ${null} where id = ${studentId}`
  const token = generateSessionToken()
  await h.sql`
    insert into credential_token (account_id, token_hash, purpose, expires_at)
    values (${studentId}, ${hashToken(token)}, 'minor_setup', now() + interval '7 days')
  `
  return token
}

/** Capture an active student_notification_email grant for a 13+ student. */
async function captureGrant(studentId: string, guardianId: string, config = defaultConfig) {
  const svc = new ConsentGrantService({ sql: h.sql, authorize, config })
  await withRequest(async () => {
    await svc.captureGrant(studentId, 'student_notification_email', guardianCtx(guardianId, [studentId]), {
      method: 'signed_form',
      evidenceArtifactRef: 'artifact://synthetic-signed-form',
      now: NOW,
    })
  })
}

// ---------------------------------------------------------------------------
describe('grant capture: the age gate + signed-form + revoke', () => {
  test('capture is REFUSED for a student under 13', async () => {
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_UNDER_13 })
    const guardian = await verifiedGuardian(student, `g-${randomUUID().slice(0, 8)}@example.test`)
    const svc = new ConsentGrantService({ sql: h.sql, authorize })
    await withRequest(async () => {
      await expect(
        svc.captureGrant(student, 'student_notification_email', guardianCtx(guardian, [student]), {
          method: 'signed_form',
          evidenceArtifactRef: 'artifact://x',
          now: NOW,
        }),
      ).rejects.toBeInstanceOf(StudentNotificationEmailAgeError)
    })
  })

  test('a 13+ capture with signed_form succeeds and is active', async () => {
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_15 })
    const guardian = await verifiedGuardian(student, `g-${randomUUID().slice(0, 8)}@example.test`)
    await captureGrant(student, guardian)
    const [row] = await h.sql`
      select active from consent_grant_current
      where subject_student_account_id = ${student} and grant_type = 'student_notification_email'
    `
    expect(row!.active).toBe(true)
  })

  test('a click is refused (signed form required, like mentor_dm)', async () => {
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_15 })
    const guardian = await verifiedGuardian(student, `g-${randomUUID().slice(0, 8)}@example.test`)
    const svc = new ConsentGrantService({ sql: h.sql, authorize })
    await withRequest(async () => {
      await expect(
        svc.captureGrant(student, 'student_notification_email', guardianCtx(guardian, [student]), {
          method: 'click',
          now: NOW,
        }),
      ).rejects.toBeInstanceOf(GrantSignedFormRequiredError)
    })
  })

  test('the grant is independently revocable', async () => {
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_15 })
    const guardian = await verifiedGuardian(student, `g-${randomUUID().slice(0, 8)}@example.test`)
    await captureGrant(student, guardian)
    const svc = new ConsentGrantService({ sql: h.sql, authorize })
    await withRequest(async () => {
      await svc.revokeGrant(student, 'student_notification_email', guardianCtx(guardian, [student]), {
        now: NOW,
      })
    })
    const [row] = await h.sql`
      select active from consent_grant_current
      where subject_student_account_id = ${student} and grant_type = 'student_notification_email'
    `
    expect(row!.active).toBe(false)
    // A second revoke (no active grant) is refused.
    await withRequest(async () => {
      await expect(
        svc.revokeGrant(student, 'student_notification_email', guardianCtx(guardian, [student]), { now: NOW }),
      ).rejects.toBeInstanceOf(GrantNotActiveError)
    })
  })
})

// ---------------------------------------------------------------------------
describe('setting notification_email at setup redemption', () => {
  async function notifEmail(studentId: string): Promise<string | null> {
    const [row] = await h.sql`select notification_email from account where id = ${studentId}`
    return (row!.notification_email as string | null) ?? null
  }

  test('REFUSED when the flag is off (even with an active grant + 13+)', async () => {
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_15 })
    const guardian = await verifiedGuardian(student, `g-${randomUUID().slice(0, 8)}@example.test`)
    await captureGrant(student, guardian)
    const token = await setupToken(student)
    const svc = new StudentSetupService({ sql: h.sql, authorize, config: flagOff })
    await expect(
      svc.redeemSetupCredential(token, 'hunter2 correct staple', {
        now: NOW,
        notificationEmail: 'kid@example.test',
      }),
    ).rejects.toBeInstanceOf(StudentNotificationEmailNotAuthorizedError)
    expect(await notifEmail(student)).toBeNull()
  })

  test('REFUSED when there is no active grant (flag on, 13+)', async () => {
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_15 })
    await verifiedGuardian(student, `g-${randomUUID().slice(0, 8)}@example.test`)
    const token = await setupToken(student)
    const svc = new StudentSetupService({ sql: h.sql, authorize, config: flagOn })
    await expect(
      svc.redeemSetupCredential(token, 'hunter2 correct staple', {
        now: NOW,
        notificationEmail: 'kid@example.test',
      }),
    ).rejects.toBeInstanceOf(StudentNotificationEmailNotAuthorizedError)
    expect(await notifEmail(student)).toBeNull()
  })

  test('SUCCEEDS when flag on + grant active + 13+, and is stored', async () => {
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_15 })
    const guardian = await verifiedGuardian(student, `g-${randomUUID().slice(0, 8)}@example.test`)
    await captureGrant(student, guardian)
    const token = await setupToken(student)
    const svc = new StudentSetupService({ sql: h.sql, authorize, config: flagOn })
    const res = await svc.redeemSetupCredential(token, 'hunter2 correct staple', {
      now: NOW,
      notificationEmail: 'kid@example.test',
    })
    expect(res.accountId).toBe(student)
    expect(await notifEmail(student)).toBe('kid@example.test')
    // The account still has NO login email and keeps its username (identity intact).
    const [acct] = await h.sql`select email, username from account where id = ${student}`
    expect(acct!.email).toBeNull()
    expect(acct!.username).not.toBeNull()
  })

  test('a redemption WITHOUT a notification email is unaffected (password only)', async () => {
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_15 })
    const token = await setupToken(student)
    const svc = new StudentSetupService({ sql: h.sql, authorize, config: flagOn })
    await svc.redeemSetupCredential(token, 'hunter2 correct staple', { now: NOW })
    expect(await notifEmail(student)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
describe('resolveStudentNotificationTargets (the parent-CC seam)', () => {
  const uniqEmail = (p: string) => `${p}-${randomUUID().slice(0, 8)}@example.test`
  const KID = () => `kid-${randomUUID().slice(0, 8)}@example.test`

  test('flag OFF => studentEmail null, ALL verified guardians returned', async () => {
    const p1 = uniqEmail('p1')
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_15 })
    const g1 = await verifiedGuardian(student, p1)
    await captureGrant(student, g1)
    await h.sql`update account set notification_email = ${KID()} where id = ${student}`
    const out = await resolveStudentNotificationTargets(h.sql, student, NOW, flagOff)
    expect(out.studentEmail).toBeNull()
    expect(out.guardianEmails).toEqual([p1])
  })

  test('flag ON + grant + 13+ + email set => studentEmail AND guardianEmails (parent-CC)', async () => {
    const p1 = uniqEmail('p1')
    const kid = KID()
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_15 })
    const g1 = await verifiedGuardian(student, p1)
    await captureGrant(student, g1)
    await h.sql`update account set notification_email = ${kid} where id = ${student}`
    const out = await resolveStudentNotificationTargets(h.sql, student, NOW, flagOn)
    expect(out.studentEmail).toBe(kid)
    // Parent-CC is structural: the guardian email is ALWAYS alongside.
    expect(out.guardianEmails).toEqual([p1])
  })

  test('flag ON but no notification_email set => studentEmail null', async () => {
    const p1 = uniqEmail('p1')
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_15 })
    const g1 = await verifiedGuardian(student, p1)
    await captureGrant(student, g1)
    const out = await resolveStudentNotificationTargets(h.sql, student, NOW, flagOn)
    expect(out.studentEmail).toBeNull()
    expect(out.guardianEmails).toEqual([p1])
  })

  test('grant REVOKED => studentEmail null (only the guardian is notified)', async () => {
    const p1 = uniqEmail('p1')
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_15 })
    const g1 = await verifiedGuardian(student, p1)
    await captureGrant(student, g1)
    await h.sql`update account set notification_email = ${KID()} where id = ${student}`
    const svc = new ConsentGrantService({ sql: h.sql, authorize })
    await withRequest(async () => {
      await svc.revokeGrant(student, 'student_notification_email', guardianCtx(g1, [student]), { now: NOW })
    })
    const out = await resolveStudentNotificationTargets(h.sql, student, NOW, flagOn)
    expect(out.studentEmail).toBeNull()
    expect(out.guardianEmails).toEqual([p1])
  })

  test('grant EXPIRED => studentEmail null', async () => {
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_15 })
    const g1 = await verifiedGuardian(student, uniqEmail('p1'))
    // A grant that expired before NOW (annual clock; capture stamped a year back).
    await h.sql`
      insert into consent_grant (
        grant_type, subject_student_account_id, guardian_account_id, method,
        evidence_artifact_ref, granted_at, expires_at
      ) values (
        'student_notification_email', ${student}, ${g1}, 'signed_form',
        'artifact://x', now() - interval '400 days', now() - interval '35 days'
      )
    `
    await h.sql`update account set notification_email = ${KID()} where id = ${student}`
    const out = await resolveStudentNotificationTargets(h.sql, student, NOW, flagOn)
    expect(out.studentEmail).toBeNull()
  })

  test('under 13 => studentEmail null even with an email set', async () => {
    // A student_notification_email grant is UNreachable for an under-13 subject
    // (service + DB both refuse), but the resolver MUST independently refuse to
    // emit a student email for an under-13 subject regardless.
    const p1 = uniqEmail('p1')
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_UNDER_13 })
    await verifiedGuardian(student, p1)
    await h.sql`update account set notification_email = ${KID()} where id = ${student}`
    const out = await resolveStudentNotificationTargets(h.sql, student, NOW, flagOn)
    expect(out.studentEmail).toBeNull()
    expect(out.guardianEmails).toEqual([p1])
  })

  test('MULTIPLE verified guardians => all returned', async () => {
    const p1 = uniqEmail('p1')
    const p2 = uniqEmail('p2')
    const kid = KID()
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_15 })
    const g1 = await verifiedGuardian(student, p1)
    await verifiedGuardian(student, p2)
    await captureGrant(student, g1)
    await h.sql`update account set notification_email = ${kid} where id = ${student}`
    const out = await resolveStudentNotificationTargets(h.sql, student, NOW, flagOn)
    expect(out.studentEmail).toBe(kid)
    expect([...out.guardianEmails].sort()).toEqual([p1, p2].sort())
  })

  test('an UNVERIFIED guardian edge is NOT returned', async () => {
    const verifiedEmail = uniqEmail('verified')
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_15 })
    const verified = await verifiedGuardian(student, verifiedEmail)
    const pending = await makeAdult(h.sql, { email: uniqEmail('pending') })
    await h.sql`
      insert into guardianship (
        guardian_account_id, student_account_id, relationship, status, verification_method
      ) values (${pending}, ${student}, 'guardian', 'pending', 'signed_form_match')
    `
    await captureGrant(student, verified)
    const out = await resolveStudentNotificationTargets(h.sql, student, NOW, flagOn)
    expect(out.guardianEmails).toEqual([verifiedEmail])
  })
})

// ---------------------------------------------------------------------------
describe('HIDDEN: notification_email never leaks to a director/staff read', () => {
  test('a director membership + guardianship read does not contain notification_email', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    await h.sql`
      insert into membership (account_id, chapter_id, role, status)
      values (${director}, ${chapter}, 'chapter_director', 'active')
    `
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_15 })
    await h.sql`
      insert into membership (account_id, chapter_id, role, status)
      values (${student}, ${chapter}, 'student', 'active')
    `
    await verifiedGuardian(student, 'secret-guardian@example.test')
    // The student has a set notification_email (the sensitive value).
    await h.sql`update account set notification_email = ${'hidden-kid@example.test'} where id = ${student}`
    // A returning enrollment so the guardianship read's lateral join resolves.
    const [appRow] = await h.sql`
      insert into application (kind, chapter_id, status, applicant_name, applicant_contact_email, guardian_name, guardian_email)
      values ('student', ${chapter}, 'accepted', 'Minor Testchild', 'p@example.test', 'Parent Testperson', 'p@example.test')
      returning id
    `
    const [term] = await h.sql`
      insert into term (chapter_id, name, starts_on, ends_on)
      values (${chapter}, 'Fall 2099', '2099-09-01', '2099-12-15') returning id
    `
    await h.sql`
      insert into enrollment_record (application_id, student_account_id, chapter_id, term_id, signed_form_ref, guardian_name_on_form, created_by)
      values (${appRow!.id}, ${student}, ${chapter}, ${term!.id}, ${randomUUID()}, 'Parent Testperson', ${director})
    `

    const ctx: AuthContext = {
      ...baseCtx(director, NOW, [
        { chapter_id: chapter, role: 'chapter_director', status: 'active', pod_id: null, tier: null, active_from: null, active_until: null },
      ]),
    }
    const ops = new OpsReadService({ sql: h.sql, authorize })
    const memberships = await withRequest(() => ops.listMemberships(ctx, { chapterId: chapter }))
    const guardianships = await withRequest(() => ops.listGuardianships(ctx, { chapterId: chapter }))

    const blob = JSON.stringify({ memberships, guardianships })
    expect(blob).not.toContain('hidden-kid@example.test')
    expect(blob).not.toContain('notification_email')
    expect(blob).not.toContain('notificationEmail')
  })
})
