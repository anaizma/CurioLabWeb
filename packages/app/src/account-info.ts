// -------------------------------------------------------------------------
// AccountService — the "My Information" self-service surface (GET/PATCH
// /api/account). A member reads the info CurioLab holds about them, and edits
// the few editable fields: `email` (role-aware) and `school` (students only).
// Everything else is read-only. Self-ONLY: every method acts on `ctx.account.id`
// (there is no id parameter anywhere), so a caller can never read or write
// another member's row.
//
// Framework-agnostic: the db handle, `authorize`, and config are injected; the
// HTTP routes are backend adapters over @curiolab/http.
//
// RECONCILIATION 1 — email is ROLE-AWARE (not a literal column map):
//   - Adult (guardian, chapter_director, mentor tiers, comms/staff, admin):
//     primaryEmail = account.email, secondaryEmail = null, emailEditable = true,
//     emailFrozenTo = null. A PATCH email updates account.email (format-validated).
//   - Student under 13: emailEditable = false, primaryEmail = emailFrozenTo =
//     the verified guardian email (contactability runs through the guardian). A
//     PATCH email is rejected by the SAME gated notification write.
//   - Student 13+: the PRIMARY/SECONDARY notification model — primaryEmail is the
//     student's own notification_email when authorized-and-set, else the guardian;
//     secondaryEmail is the live guardian when the student set their own; editable
//     iff the flag is on + 13+ + an active student_notification_email grant. A
//     PATCH email DELEGATES to the same gated notification write (sets
//     notification_email, NEVER account.email) — one enforcement path, not two.
//
// RECONCILIATION 2 — school is a first-class editable field (migration 0038):
//   GET returns account.school when set, else FALLS BACK to the student's
//   application_draft.parent_answers.schoolName (so pre-existing students show
//   their funnel value with no data migration); PATCH (students only) writes
//   account.school. grade stays READ-ONLY from parent_answers.gradeEntering.
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import type { AuthContext, Membership, Resource, Role } from '@curiolab/core'
import { assertAuthorized, writeAudit, type AuthorizeDeps } from '@curiolab/runtime'
import { type AppConfig, defaultConfig } from './config.js'
import { StudentNotificationSettingsService } from './student-notification.js'
import { AccountFieldNotEditableError, InvalidAccountEmailError } from './errors.js'

/**
 * The injected `authorize`, narrowed to the capabilities this surface (and the
 * notification sub-service it delegates to) resolve through. The runtime
 * `authorize` wrapper is structurally assignable.
 */
export type AccountSelfAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability:
    | 'account.self.manage'
    | 'student.set_notification_email'
    | 'student.view_notification_email',
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface AccountServiceDeps {
  sql: Sql
  authorize: AccountSelfAuthorizeFn
  config?: Partial<AppConfig>
}

/** The self-view returned by GET /api/account. Fields not applicable to the role are null. */
export interface AccountInfo {
  /** Display role: a chapter Role, `guardian`, or `member` (no membership/edge). */
  role: string
  /** Human label for the role (e.g. "Chapter Director"). */
  roleLabel: string
  /** The caller's full legal name. */
  fullName: string
  /** Student: ISO YYYY-MM-DD DOB; null for a non-student. */
  dateOfBirth: string | null
  /** The caller's computed age (same helper as the session). */
  age: number
  /** Role-aware primary email (see RECONCILIATION 1). */
  primaryEmail: string | null
  /** Role-aware secondary email (a student's live guardian when they set their own). */
  secondaryEmail: string | null
  /** Student: account.school ?? parent_answers.schoolName; null otherwise. */
  school: string | null
  /** Student: parent_answers.gradeEntering (READ-ONLY); null otherwise. */
  grade: string | null
  /** Guardian: their phone from a child's parent_answers.guardianPhone (READ-ONLY). */
  phone: string | null
  /** Student: the verified guardian's name + email. */
  guardian: { name: string; email: string | null } | null
  /** Guardian: the verified children's display names. */
  children: { name: string }[] | null
  /** A member's chapter name (director/staff); null otherwise. */
  chapter: string | null
  /** Whether the email field is editable for this member right now. */
  emailEditable: boolean
  /** When frozen, the (guardian) email shown in the locked field; null when editable. */
  emailFrozenTo: string | null
}

export interface UpdateAccountInput {
  /** A new email (role-aware target). Absent/non-string = no email change. */
  email?: unknown
  /** A new school (students only). Absent = no school change; empty/null clears it. */
  school?: unknown
}

const ROLE_LABELS: Record<string, string> = {
  student: 'Student',
  guardian: 'Guardian',
  chapter_director: 'Chapter Director',
  lead_instructor: 'Lead Instructor',
  senior_instructor: 'Senior Instructor',
  junior_mentor: 'Mentor',
  comms_associate: 'Communications Associate',
  safety_officer: 'Safety Officer',
  platform_admin: 'Platform Admin',
  platform_staff: 'Platform Staff',
  alumni: 'Alumni',
  member: 'Member',
}

/** A deliberately-forgiving email shape check (local@domain.tld). */
function isValidEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
}

/** Read a trimmed non-empty string value from a jsonb answers blob, else null. */
function answerString(blob: unknown, key: string): string | null {
  if (blob == null || typeof blob !== 'object') return null
  const v = (blob as Record<string, unknown>)[key]
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/** A membership is in force iff active AND active_from <= now < active_until. */
function inForce(m: Membership, nowMs: number): boolean {
  if (m.status !== 'active') return false
  if (m.active_from !== null && m.active_from > nowMs) return false
  if (m.active_until !== null && nowMs >= m.active_until) return false
  return true
}

export class AccountService {
  private readonly sql: Sql
  private readonly authorize: AccountSelfAuthorizeFn
  private readonly config: AppConfig

  constructor(deps: AccountServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
    this.config = { ...defaultConfig, ...deps.config }
  }

  private notifSvc(): StudentNotificationSettingsService {
    return new StudentNotificationSettingsService({
      sql: this.sql,
      authorize: this.authorize,
      config: this.config,
    })
  }

  /** The caller's in-force memberships at `now`. */
  private inForceMemberships(ctx: AuthContext, nowMs: number): Membership[] {
    return ctx.memberships.filter((m) => inForce(m, nowMs))
  }

  /** True iff the caller holds an in-force STUDENT membership (the student surface). */
  private isStudent(ctx: AuthContext, nowMs: number): boolean {
    return this.inForceMemberships(ctx, nowMs).some((m) => m.role === 'student')
  }

  /** The display role: a student membership, else any membership role, else guardian, else member. */
  private primaryRole(ctx: AuthContext, nowMs: number): string {
    const active = this.inForceMemberships(ctx, nowMs)
    const student = active.find((m) => m.role === 'student')
    if (student) return 'student'
    if (active.length > 0) return active[0]!.role as Role
    if (ctx.guardianOf.length > 0) return 'guardian'
    return 'member'
  }

  /**
   * GET /api/account — assemble the caller's OWN info per role. Self-only: it
   * reads ctx.account.id, never an id parameter. No `authorize` gate — this is a
   * self-read of one's own row, the same self-session pattern as GET
   * /api/auth/session (and it is GET-exempt from the route manifest). Minor PII
   * rules for STAFF reads elsewhere are untouched: this endpoint only ever returns
   * the requesting member's own data.
   */
  async getAccount(ctx: AuthContext, opts: { now?: Date } = {}): Promise<AccountInfo> {
    const now = opts.now ?? new Date()
    const nowMs = now.getTime()
    const accountId = ctx.account.id

    const [acct] = await this.sql`
      select legal_name, display_name, date_of_birth::text as dob, email, school
      from account where id = ${accountId}
    `
    const legalName = (acct?.legal_name as string | null) ?? ''
    const isStudent = this.isStudent(ctx, nowMs)
    const role = this.primaryRole(ctx, nowMs)

    const info: AccountInfo = {
      role,
      roleLabel: ROLE_LABELS[role] ?? 'Member',
      fullName: legalName,
      dateOfBirth: null,
      age: ctx.account.age,
      primaryEmail: null,
      secondaryEmail: null,
      school: null,
      grade: null,
      phone: null,
      guardian: null,
      children: null,
      chapter: null,
      emailEditable: false,
      emailFrozenTo: null,
    }

    if (isStudent) {
      // Email via the PRIMARY/SECONDARY notification model (RECONCILIATION 1). This
      // authorizes student.view_notification_email (own) and applies the same
      // flag/13+/grant gate as the write, so a dark/under-13 student is frozen to
      // the guardian, and a 13+ authorized student sees their own primary.
      const settings = await this.notifSvc().viewSettings(ctx, { now })
      info.primaryEmail = settings.primary.email
      info.secondaryEmail = settings.secondary.email
      info.emailEditable = settings.primary.editable
      // When not editable the primary IS the guardian email (frozen); when editable,
      // no freeze.
      info.emailFrozenTo = settings.primary.editable ? null : settings.primary.email

      info.dateOfBirth = (acct?.dob as string | null) ?? null

      const answers = await this.studentParentAnswers(accountId)
      info.school = ((acct?.school as string | null) ?? null) || answerString(answers, 'schoolName')
      info.grade = answerString(answers, 'gradeEntering')
      info.guardian = await this.firstGuardian(accountId)
    } else {
      // Adult (guardian, director, mentor tiers, comms/staff, admin): the login
      // email is the primary and is editable; no secondary, no freeze.
      info.primaryEmail = (acct?.email as string | null) ?? null
      info.secondaryEmail = null
      info.emailEditable = true
      info.emailFrozenTo = null

      if (role === 'guardian') {
        info.children = await this.guardianChildren(ctx)
        info.phone = await this.guardianPhone(ctx)
      }

      // A member's chapter name (director / staff), from their first in-force
      // chapter membership.
      const active = this.inForceMemberships(ctx, nowMs)
      const chapterId = active.find((m) => m.chapter_id != null)?.chapter_id ?? null
      if (chapterId != null) {
        const [ch] = await this.sql`select name from chapter where id = ${chapterId}`
        info.chapter = (ch?.name as string | null) ?? null
      }
    }

    return info
  }

  /**
   * PATCH /api/account — update the editable fields, SERVER-ENFORCED (the client
   * is never trusted). Body `{ email?, school? }`; any other field is ignored.
   * Gated through `authorize` under `account.self.manage` (own scope; self-owner
   * is the authority, so it authorizes a membership-less guardian too) — records
   * the decision the write backstop requires and anchors the audit. Then per field:
   *   - email: adult → update account.email (format-validated, else 400); student →
   *     DELEGATE to the gated student-notification primary write (sets
   *     notification_email; under-13 / flag-off / no-grant → opaque 403; the
   *     maturation coming-of-age email path stays separate).
   *   - school: students only → update account.school; a non-student is rejected.
   * Each accepted change writes an `audit_entry` (the field name, never the value).
   * Returns the fresh self-view.
   */
  async updateAccount(
    ctx: AuthContext,
    input: UpdateAccountInput,
    opts: { now?: Date } = {},
  ): Promise<AccountInfo> {
    const now = opts.now ?? new Date()
    const nowMs = now.getTime()
    const accountId = ctx.account.id
    const isStudent = this.isStudent(ctx, nowMs)
    const realActor = ctx.session.impersonation?.real_actor_account_id ?? null

    const hasEmail = typeof input.email === 'string'
    const hasSchool = 'school' in input && input.school !== undefined

    // Self-ownership authorization (own scope, self-owner is the authority). Records
    // the decision the repository-write backstop requires; works for a
    // membership-less guardian. Done BEFORE any mutation.
    const resource: Resource = { ownerAccountId: accountId }
    await this.authorize(ctx, 'account.self.manage', resource, { sql: this.sql })

    // ---- email ----------------------------------------------------------------
    if (hasEmail) {
      const email = (input.email as string).trim()
      if (isStudent) {
        // ONE enforcement path: the gated student-notification primary write. It
        // authorizes student.set_notification_email (own) and applies the flag/13+/
        // grant gate (opaque 403 on any miss — covers under-13 and flag-off), then
        // validates the address. Sets notification_email, NEVER account.email; the
        // coming-of-age (maturation) email path is separate and untouched.
        await this.notifSvc().setPrimaryEmail(email, ctx, { now })
        await writeAudit(this.sql, {
          action: 'account.email_changed',
          subjectType: 'account',
          subjectId: accountId,
          actorAccountId: accountId,
          realActorAccountId: realActor,
          detail: { field: 'email', via: 'student_notification_primary' },
        })
      } else {
        if (!isValidEmail(email)) throw new InvalidAccountEmailError()
        await this.sql.begin(async (tx) => {
          assertAuthorized()
          await tx`update account set email = ${email} where id = ${accountId}`
          await writeAudit(tx, {
            action: 'account.email_changed',
            subjectType: 'account',
            subjectId: accountId,
            actorAccountId: accountId,
            realActorAccountId: realActor,
            detail: { field: 'email' },
          })
        })
      }
    }

    // ---- school (students only) -----------------------------------------------
    if (hasSchool) {
      if (!isStudent) throw new AccountFieldNotEditableError('school')
      const raw = input.school
      const school = raw == null ? null : String(raw).trim() || null
      await this.sql.begin(async (tx) => {
        assertAuthorized()
        await tx`update account set school = ${school} where id = ${accountId}`
        await writeAudit(tx, {
          action: 'account.school_changed',
          subjectType: 'account',
          subjectId: accountId,
          actorAccountId: accountId,
          realActorAccountId: realActor,
          detail: { field: 'school' },
        })
      })
    }

    return this.getAccount(ctx, { now })
  }

  // ---- reads ----------------------------------------------------------------

  /** The student's own funnel parent_answers (via enrollment -> converted draft). */
  private async studentParentAnswers(studentAccountId: string): Promise<Record<string, unknown> | null> {
    const [row] = await this.sql`
      select d.parent_answers
      from enrollment_record er
      join application_draft d on d.converted_application_id = er.application_id
      where er.student_account_id = ${studentAccountId}
      order by d.created_at desc
      limit 1
    `
    return (row?.parent_answers as Record<string, unknown> | null) ?? null
  }

  /** The first verified guardian's name + login email for a student. */
  private async firstGuardian(studentAccountId: string): Promise<{ name: string; email: string | null } | null> {
    const [row] = await this.sql`
      select a.legal_name as name, a.email as email
      from guardianship g
      join account a on a.id = g.guardian_account_id
      where g.student_account_id = ${studentAccountId} and g.status = 'verified'
      order by (a.email is null), a.email asc
      limit 1
    `
    if (row === undefined) return null
    return { name: row.name as string, email: (row.email as string | null) ?? null }
  }

  /** The guardian's verified children (display names), from ctx.guardianOf. */
  private async guardianChildren(ctx: AuthContext): Promise<{ name: string }[]> {
    if (ctx.guardianOf.length === 0) return []
    const rows = await this.sql`
      select display_name from account where id in ${this.sql(ctx.guardianOf)}
      order by display_name asc
    `
    return rows.map((r) => ({ name: r.display_name as string }))
  }

  /** The guardian's phone from a verified child's parent_answers.guardianPhone. */
  private async guardianPhone(ctx: AuthContext): Promise<string | null> {
    const child = ctx.guardianOf[0]
    if (child == null) return null
    const answers = await this.studentParentAnswers(child)
    return answerString(answers, 'guardianPhone')
  }
}
