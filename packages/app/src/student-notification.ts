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
import type { AuthContext, Resource } from '@curiolab/core'
import { assertAuthorized, type AuthorizeDeps } from '@curiolab/runtime'
import { type AppConfig, defaultConfig } from './config.js'
import { hasActiveGrant } from './consent-grant.js'
import {
  InvalidNotificationEmailError,
  StudentNotificationEmailNotAuthorizedError,
} from './errors.js'

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

// -------------------------------------------------------------------------
// The PRIMARY / SECONDARY self-service settings surface (DARK, counsel-gated).
//
//   PRIMARY   = the student's OWN notification_email (stored on `account`;
//               student-editable through this service, but only when authorized).
//   SECONDARY = the LIVE first verified-guardian email — NOT a stored column, so
//               it can neither be removed by the student nor go stale; it is never
//               student-editable.
//
// `resolveStudentNotificationTargets` remains the single ENFORCEMENT point for
// outbound contactability; this service is the settings WRITE + the read model on
// top. The write authorizes the own-scope capability (a student acting on their
// OWN account), then applies the same opaque gate as the setup-time setter (the
// global flag on + 13+ + an active student_notification_email grant) before any
// mutation. With the flag off the whole surface is inert.
// -------------------------------------------------------------------------

/** A minimal, deliberately-forgiving email shape check (local@domain.tld). */
function isValidEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
}

/**
 * Whether the student MAY have an own primary notification email right now — the
 * flag is on, the student is 13+ (age from DOB), AND a current
 * student_notification_email grant is active. This is BOTH the write gate and the
 * read model's `editable` bit. Independent of whether an email is actually set
 * (that extra condition is the resolver's studentEmail emission).
 */
async function isNotificationEmailAuthorized(
  sql: Db,
  accountId: string,
  now: Date,
  config: AppConfig,
): Promise<boolean> {
  if (!config.studentNotificationEmailEnabled) return false
  const [acct] = await sql`select date_of_birth as dob from account where id = ${accountId}`
  if (acct === undefined) return false
  const age = ageInYears(new Date(acct.dob as string), now)
  if (age < 13) return false
  return hasActiveGrant(sql, accountId, 'student_notification_email', now)
}

/** The PRIMARY slot of the settings model — the student's own, editable address. */
export interface NotificationEmailPrimary {
  /**
   * The address shown as the primary: the student's OWN notification_email when
   * they have set an authorized one (`isOwn: true`), otherwise the verified-guardian
   * email they are "using the parent's" (`isOwn: false`), or null if neither exists.
   */
  email: string | null
  /** True iff `email` is the student's own notification_email (not the parent's). */
  isOwn: boolean
  /**
   * Whether the student may set/change their own primary right now (flag on + 13+
   * + active grant). False when the feature is dark for them (flag off / under-13 /
   * no active grant) — the settings screen then shows a read-only parent-only view.
   */
  editable: boolean
}

/** The SECONDARY slot — the live verified-guardian email, never student-editable. */
export interface NotificationEmailSecondary {
  /** The first verified-guardian email when a student primary is set; else null. */
  email: string | null
  /** Always false: the secondary is the live guardian and is never student-editable. */
  editable: false
}

/** The settings-screen model: the student's primary + the (live) guardian secondary. */
export interface NotificationEmailSettings {
  primary: NotificationEmailPrimary
  secondary: NotificationEmailSecondary
}

/**
 * The injected `authorize` dependency, narrowed to this service's two own-scoped
 * capabilities (structurally the runtime `authorize` wrapper; injected so the
 * deny/backstop paths are testable without HTTP).
 */
export type StudentNotificationAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: 'student.set_notification_email' | 'student.view_notification_email',
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface StudentNotificationSettingsServiceDeps {
  sql: Sql
  authorize: StudentNotificationAuthorizeFn
  config?: Partial<AppConfig>
}

export class StudentNotificationSettingsService {
  private readonly sql: Sql
  private readonly authorize: StudentNotificationAuthorizeFn
  private readonly config: AppConfig

  constructor(deps: StudentNotificationSettingsServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
    this.config = { ...defaultConfig, ...deps.config }
  }

  /**
   * PUT /api/portal/student/notification-email — set / update / clear the PRIMARY.
   *
   * Gated through `authorize` under `student.set_notification_email` (own scope —
   * the resource owner is the acting student, so a caller can only ever act on
   * their OWN account; a non-student actor denies out_of_scope/role_not_permitted).
   * Then the same opaque gate as setup-time setting: the global flag on AND 13+ AND
   * an active student_notification_email grant — any miss is one
   * StudentNotificationEmailNotAuthorizedError (403), whether setting or clearing,
   * so the feature is fully dark with the flag off. A non-null email must be
   * well-formed (InvalidNotificationEmailError, 400), checked only after the gate so
   * it never leaks authorization state. Clearing passes `null` (reverts to
   * parent-only). Returns the fresh settings model.
   */
  async setPrimaryEmail(
    email: string | null,
    ctx: AuthContext,
    opts: { now?: Date } = {},
  ): Promise<NotificationEmailSettings> {
    const now = opts.now ?? new Date()
    const accountId = ctx.account.id
    const resource: Resource = { ownerAccountId: accountId }
    await this.authorize(ctx, 'student.set_notification_email', resource, { sql: this.sql })

    // The opaque contactability gate (flag + 13+ + active grant). Applies to a
    // clear too — with the flag off there is nothing to clear anyway.
    const authorized = await isNotificationEmailAuthorized(this.sql, accountId, now, this.config)
    if (!authorized) throw new StudentNotificationEmailNotAuthorizedError(accountId)

    // Validate only after the gate (a 400 here never distinguishes an authorized
    // account). Clearing (null) skips validation.
    const normalized = email === null ? null : email.trim()
    if (normalized !== null && !isValidEmail(normalized)) {
      throw new InvalidNotificationEmailError()
    }

    await this.sql.begin(async (tx) => {
      assertAuthorized() // runtime backstop: no mutation without a recorded decision
      await tx`update account set notification_email = ${normalized} where id = ${accountId}`
    })

    return this.viewSettings(ctx, { now })
  }

  /**
   * GET /api/portal/student/notification-email — the settings-screen model.
   *
   * Gated through `authorize` under `student.view_notification_email` (own scope).
   * Reads the LIVE targets via `resolveStudentNotificationTargets` (so the student
   * email surfaces ONLY under the full authorization chain and the guardian email
   * is always the live one). The `editable` bit and the "using the parent's" state
   * follow the same gate as the write.
   */
  async viewSettings(
    ctx: AuthContext,
    opts: { now?: Date } = {},
  ): Promise<NotificationEmailSettings> {
    const now = opts.now ?? new Date()
    const accountId = ctx.account.id
    const resource: Resource = { ownerAccountId: accountId }
    await this.authorize(ctx, 'student.view_notification_email', resource, { sql: this.sql })

    const targets = await resolveStudentNotificationTargets(this.sql, accountId, now, this.config)
    const firstGuardian = targets.guardianEmails[0] ?? null

    if (targets.studentEmail !== null) {
      // Authorized AND set: primary is the student's own; secondary is the guardian.
      return {
        primary: { email: targets.studentEmail, isOwn: true, editable: true },
        secondary: { email: firstGuardian, editable: false },
      }
    }

    // No authorized own primary: the student is "using the parent's" email. The
    // primary shows the guardian; whether the student may set their own is the gate.
    const editable = await isNotificationEmailAuthorized(this.sql, accountId, now, this.config)
    return {
      primary: { email: firstGuardian, isOwn: false, editable },
      secondary: { email: null, editable: false },
    }
  }
}
