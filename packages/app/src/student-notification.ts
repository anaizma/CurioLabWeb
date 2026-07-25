// -------------------------------------------------------------------------
// Student notification-email — the parent-CC RESOLVER SEAM (the core safety
// primitive). A pure, well-tested function that a notification caller (e.g. the
// DM-notification code) uses to decide WHO a student-directed notification reaches.
//
// The one structural guarantee: you CANNOT get a student email out of this
// resolver without the guardian emails alongside. Parent-CC is not a caller
// convention — it is baked into the return shape: `guardianEmails` (ALL verified
// guardians' login emails) is ALWAYS returned; `studentEmail` is returned ONLY
// when every gate holds and is `null` otherwise. A caller notifies `studentEmail`
// (if non-null) AND ALWAYS every `guardianEmails` address.
//
// `studentEmail` is non-null ONLY IF, at `now`:
//   1. the GLOBAL flag STUDENT_NOTIFICATION_EMAIL_ENABLED is on (config.studentNotificationEmailEnabled),
//   2. the student is 13+ (age computed from DOB),
//   3. a current (non-revoked, non-expired) `student_notification_email` grant is active, AND
//   4. the account's `notification_email` is set.
// In ANY other case — flag off, under 13, no/revoked/expired grant, or unset —
// `studentEmail` is null: the student "takes on the parent's email" and only the
// guardian is notified. With the flag off the whole feature is DARK.
//
// Framework-agnostic: the db handle, now, and config are injected.
// -------------------------------------------------------------------------

import type { Sql, TransactionSql } from 'postgres'
import { type AppConfig, defaultConfig } from './config.js'
import { hasActiveGrant } from './consent-grant.js'

type Db = Sql | TransactionSql

export interface StudentNotificationTargets {
  /**
   * The student's own notification address, or null. Non-null ONLY when the flag
   * is on AND the student is 13+ AND an active student_notification_email grant is
   * on file AND notification_email is set — otherwise null (only the guardian is
   * notified). When non-null it is ALWAYS accompanied by guardianEmails (parent-CC).
   */
  studentEmail: string | null
  /** ALL verified guardians' login emails for the student. ALWAYS returned. */
  guardianEmails: string[]
}

/** Whole years from `dob` to `at` (birthday-aware, UTC). */
function ageInYears(dob: Date, at: Date): number {
  let age = at.getUTCFullYear() - dob.getUTCFullYear()
  const m = at.getUTCMonth() - dob.getUTCMonth()
  if (m < 0 || (m === 0 && at.getUTCDate() < dob.getUTCDate())) age -= 1
  return age
}

/**
 * Resolve the notification targets for a student. `guardianEmails` is every
 * verified guardian's login email (parent-CC, always). `studentEmail` is the
 * student's notification_email only when the full authorization chain holds at
 * `now` (see the module note); null in every other case. The flag defaults to the
 * env-derived `defaultConfig` (dark unless STUDENT_NOTIFICATION_EMAIL_ENABLED);
 * tests inject config to exercise both states.
 */
export async function resolveStudentNotificationTargets(
  sql: Db,
  studentAccountId: string,
  now: Date = new Date(),
  config: AppConfig = defaultConfig,
): Promise<StudentNotificationTargets> {
  // Parent-CC: ALL verified guardians' login emails, always. Ordered for
  // determinism; a guardian with no login email (should not happen for an adult)
  // is skipped by the `email is not null` guard.
  const guardianRows = await sql`
    select a.email
    from guardianship g
    join account a on a.id = g.guardian_account_id
    where g.student_account_id = ${studentAccountId}
      and g.status = 'verified'
      and a.email is not null
    order by a.email asc
  `
  const guardianEmails = guardianRows.map((r) => r.email as string)

  // The student email is emitted ONLY when every gate holds. Short-circuit on the
  // flag so the feature is fully dark (no grant read, no email read) when off.
  let studentEmail: string | null = null
  if (config.studentNotificationEmailEnabled) {
    const [acct] = await sql`
      select date_of_birth as dob, notification_email from account where id = ${studentAccountId}
    `
    if (acct !== undefined) {
      const notificationEmail = (acct.notification_email as string | null) ?? null
      const age = ageInYears(new Date(acct.dob as string), now)
      if (notificationEmail !== null && age >= 13) {
        const active = await hasActiveGrant(sql, studentAccountId, 'student_notification_email', now)
        if (active) studentEmail = notificationEmail
      }
    }
  }

  return { studentEmail, guardianEmails }
}
