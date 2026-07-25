// -------------------------------------------------------------------------
// STUDENT NOTIFICATION-EMAIL schema — the DARK, counsel-gated minor-contactability
// primitive (build OFF by default; enabling makes a minor directly contactable).
//
// Two additive migrations, split so the new enum value is COMMITTED before any
// statement references it (the same PostgreSQL 55P04 split the 0029 -> 0030
// mentor_dm migrations use):
//   0036_student_notification_email_enum.sql  — ALTER TYPE consent_grant_type
//     ADD VALUE 'student_notification_email' (its own transaction);
//   0037_student_notification_email.sql       — the nullable `notification_email
//     citext` column on `account` (distinct from the login `email`; does NOT
//     participate in the email-XOR-username identity constraint) + the under-13
//     age-floor DB trigger that REFUSES a student_notification_email grant for a
//     subject under 13 (COPPA bites hardest under 13; the service is the primary
//     gate, the trigger is the backstop, since application code can be bypassed).
//
// TDD: run with CURIOLAB_MIGRATE_UPTO=0035 to witness these fail (neither the
// column, the enum value, nor the trigger exist yet); the default run applies
// 0036 + 0037 and they pass.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startHarness, type Harness } from './helpers/pg.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness({ uptoInclusive: process.env.CURIOLAB_MIGRATE_UPTO })
}, 240_000)

afterAll(async () => {
  await h?.end()
})

/** A minor subject with a given DOB, plus a guardian to capture the grant. */
async function subjectAndGuardian(subjectDob: string): Promise<{ subject: string; guardian: string }> {
  const [g] = await h.sql`
    insert into account (
      email, username, legal_name, display_name, date_of_birth,
      dob_provenance, dob_source_ref, credential_owner, status, maturation_state
    ) values (
      ${`gr-${randomUUID().slice(0, 8)}@example.test`}, ${null}, 'Adult Testperson', 'Adult T.',
      '1990-01-01', 'self_reported', ${null}, 'self_private', 'active', 'self_managed'
    ) returning id
  `
  const [s] = await h.sql`
    insert into account (
      email, username, legal_name, display_name, date_of_birth,
      dob_provenance, dob_source_ref, credential_owner, status, maturation_state
    ) values (
      ${null}, ${`st-${randomUUID().slice(0, 8)}`}, 'Minor Testchild', 'Minor T.',
      ${subjectDob}, 'enrollment_record', ${randomUUID()}, 'guardian_provisioned', 'active', 'minor'
    ) returning id
  `
  return { subject: s!.id as string, guardian: g!.id as string }
}

// ---------------------------------------------------------------------------
describe('account.notification_email column', () => {
  test('a nullable notification_email exists and holds an outbound-only address', async () => {
    const { subject } = await subjectAndGuardian('2010-06-01')
    // A minor keeps username set + email null; notification_email is DISTINCT and
    // does NOT participate in the email-XOR-username identity constraint.
    await h.sql`update account set notification_email = ${'ping@example.test'} where id = ${subject}`
    const [row] = await h.sql`
      select email, username, notification_email from account where id = ${subject}
    `
    expect(row!.email).toBeNull() // still no login email
    expect(row!.username).not.toBeNull() // still username-identified
    expect(row!.notification_email).toBe('ping@example.test')
  })

  test('notification_email defaults to null (unset)', async () => {
    const { subject } = await subjectAndGuardian('2010-06-01')
    const [row] = await h.sql`select notification_email from account where id = ${subject}`
    expect(row!.notification_email).toBeNull()
  })
})

describe('consent_grant_type: student_notification_email', () => {
  test('the enum value exists and a 13+ signed_form grant row inserts', async () => {
    const { subject, guardian } = await subjectAndGuardian('2010-06-01') // 13+ at 2026
    const [row] = await h.sql`
      insert into consent_grant (
        grant_type, subject_student_account_id, guardian_account_id, method,
        evidence_artifact_ref, granted_at
      ) values (
        'student_notification_email', ${subject}, ${guardian}, 'signed_form',
        'artifact://synthetic-signed-form', now()
      ) returning id
    `
    expect(row!.id).toBeTruthy()
  })
})

describe('the under-13 student_notification_email DB floor', () => {
  test('a grant for a subject UNDER 13 is REFUSED by the trigger backstop', async () => {
    const { subject, guardian } = await subjectAndGuardian('2020-06-01') // ~6 at 2026
    await expect(h.sql`
      insert into consent_grant (
        grant_type, subject_student_account_id, guardian_account_id, method,
        evidence_artifact_ref, granted_at
      ) values (
        'student_notification_email', ${subject}, ${guardian}, 'signed_form',
        'artifact://synthetic-signed-form', now()
      )
    `).rejects.toThrow(/under 13|13 years/i)
  })

  test('a 13+ subject is accepted (age computed from DOB at granted_at)', async () => {
    const { subject, guardian } = await subjectAndGuardian('2011-01-01') // 15 at 2026
    const [row] = await h.sql`
      insert into consent_grant (
        grant_type, subject_student_account_id, guardian_account_id, method,
        evidence_artifact_ref, granted_at
      ) values (
        'student_notification_email', ${subject}, ${guardian}, 'signed_form',
        'artifact://synthetic-signed-form', now()
      ) returning id
    `
    expect(row!.id).toBeTruthy()
  })

  test('a REVOCATION row for an under-13 subject is EXEMPT (rule applies to grants)', async () => {
    const { subject, guardian } = await subjectAndGuardian('2020-06-01') // under 13
    // A revocation/lapse row (revoked_at set) is exempt from the age floor, like
    // the under-13 public_publication and mentor_dm floors.
    const [row] = await h.sql`
      insert into consent_grant (
        grant_type, subject_student_account_id, guardian_account_id, method,
        granted_at, revoked_at, revoked_by
      ) values (
        'student_notification_email', ${subject}, ${guardian}, 'click',
        now(), now(), ${guardian}
      ) returning id
    `
    expect(row!.id).toBeTruthy()
  })
})
