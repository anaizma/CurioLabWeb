// -------------------------------------------------------------------------
// StudentSetupService — the account-origination chain's §3 student-credential
// step: the guardian-ORIGINATED setup-credential mint and the token-gated
// redemption. Together they replace the (retired) director-issued student invite:
// the credential for a minor's inert shell account (created at enrollment) is
// minted BY the verified guardian, delivered to the child in person, and redeemed
// once to set the password. The account stays `pending` throughout — a setup
// credential alone never activates a membership.
//
//   provisionSetupCredential  guardian-authed (guardian.provision_child)
//   redeemSetupCredential     UNAUTHENTICATED, token-gated (like invite accept)
//
// GUARDIAN-BEFORE-STUDENT (the COPPA ordering invariant): the mint is refused
// unless a VERIFIED guardianship edge exists AND the guardian's participation
// consent is on file (assertStudentGuardianGate) — AND the `guardian` scope on
// `guardian.provision_child` already requires the child in ctx.guardianOf (a
// verified edge), so an unverified guardian denies out_of_scope before the gate
// even runs. The one-time credential is bound to the child account but ROUTED to
// the guardian (never emailed to the child); the frontend/ops hand-off is a seam.
//
// Framework-agnostic: the db handle and `authorize` are injected; the HTTP routes
// (POST /api/guardian/children/:id/setup-credential, POST /api/setup/student/:token)
// are thin adapters over these methods.
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import type { AuthContext, Resource } from '@curiolab/core'
import {
  assertAuthorized,
  generateSessionToken,
  hashPassword,
  hashToken,
  writeAccessLedger,
  type AuthorizeDeps,
} from '@curiolab/runtime'
import { type AppConfig, defaultConfig } from './config.js'
import { assertStudentGuardianGate } from './invite.js'
import { hasActiveGrant } from './consent-grant.js'
import {
  GuardianChildNotFoundError,
  InvalidCredentialTokenError,
  StudentNotificationEmailNotAuthorizedError,
} from './errors.js'

/** Whole years from `dob` to `at` (birthday-aware, UTC). */
function ageInYears(dob: Date, at: Date): number {
  let age = at.getUTCFullYear() - dob.getUTCFullYear()
  const m = at.getUTCMonth() - dob.getUTCMonth()
  if (m < 0 || (m === 0 && at.getUTCDate() < dob.getUTCDate())) age -= 1
  return age
}

/**
 * The injected `authorize` dependency, narrowed to this service's one capability
 * (structurally the runtime `authorize` wrapper; taken by injection so the
 * deny/backstop paths are testable without HTTP).
 */
export type StudentSetupAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: 'guardian.provision_child',
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface StudentSetupServiceDeps {
  sql: Sql
  authorize: StudentSetupAuthorizeFn
  /** Optional overrides for the config-not-code tunables (e.g. the setup TTL). */
  config?: Partial<AppConfig>
}

export interface ProvisionSetupCredentialResult {
  studentAccountId: string
  /** The opaque one-time setup token, returned ONCE (the guardian-delivery seam). */
  setupToken: string
  expiresAt: Date
  /** The verified guardian the credential is routed to; delivery route is always guardian. */
  guardianAccountId: string
  route: 'guardian'
}

export interface RedeemSetupCredentialResult {
  accountId: string
}

export class StudentSetupService {
  private readonly sql: Sql
  private readonly authorize: StudentSetupAuthorizeFn
  private readonly config: AppConfig

  constructor(deps: StudentSetupServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
    this.config = { ...defaultConfig, ...deps.config }
  }

  // ---- provision (POST /api/guardian/children/:id/setup-credential) --------
  /**
   * The verified guardian mints their child's one-time `minor_setup` credential.
   * Gated through `authorize` under `guardian.provision_child` (guardian scope,
   * matched against ctx.guardianOf — an unverified/lapsed edge denies out_of_scope),
   * then floored again by assertStudentGuardianGate (a VERIFIED edge AND the
   * guardian's participation consent on file). In one transaction it supersedes any
   * prior live `minor_setup` token for the child and inserts a fresh one, and writes
   * an access_ledger row (who provisioned whom, guardian-routed). The raw token is
   * returned ONCE for the guardian to hand to the child; only its hash is stored.
   */
  async provisionSetupCredential(
    studentAccountId: string,
    ctx: AuthContext,
    opts: { clientIp?: string | null } = {},
  ): Promise<ProvisionSetupCredentialResult> {
    // Resolve the child's enrolling chapter (the guardian-scope resource) and age
    // (the guardian write age-18 bar). A pending shell always has an enrollment.
    const [row] = await this.sql`
      select
        a.date_of_birth as dob,
        (a.date_of_birth + interval '18 years' <= now()::date) as is_adult,
        (
          select chapter_id from enrollment_record
          where student_account_id = a.id order by created_at desc limit 1
        ) as chapter_id
      from account a where a.id = ${studentAccountId}
    `
    if (row === undefined || row.chapter_id == null) {
      throw new GuardianChildNotFoundError(studentAccountId)
    }
    const chapterId = row.chapter_id as string

    // Authorize against the guardian's own verified child BEFORE any mutation. A
    // stranger / unverified / lapsed guardian denies out_of_scope; an 18+ child
    // bars the guardian write (majority ends guardian write authority).
    const resource: Resource = {
      id: studentAccountId,
      chapter_id: chapterId,
      subjectAccountId: studentAccountId,
      subjectAge: row.is_adult === true ? 18 : 0,
      subjectIsMinor: row.is_adult !== true,
    }
    await this.authorize(ctx, 'guardian.provision_child', resource, { sql: this.sql })

    // §3 floor (defence in depth over the scope): a VERIFIED edge AND participation
    // consent on file. Returns the verified guardian the credential routes to.
    const { guardianAccountId } = await assertStudentGuardianGate(this.sql, studentAccountId)

    const token = generateSessionToken()
    const tokenHash = hashToken(token)
    const expiresAt = new Date(Date.now() + this.setupTtlMs())

    await this.sql.begin(async (tx) => {
      assertAuthorized() // runtime backstop: no mutation without a recorded decision
      // A regenerate supersedes any prior live minor_setup token for the child.
      await tx`
        update credential_token set consumed_at = now()
        where account_id = ${studentAccountId} and purpose = 'minor_setup' and consumed_at is null
      `
      await tx`
        insert into credential_token (account_id, token_hash, purpose, expires_at)
        values (${studentAccountId}, ${tokenHash}, 'minor_setup', ${expiresAt})
      `
      // §8: the guardian-routed provisioning is on the ledger (who provisioned the
      // child, the verified guardian, the chapter, IP) — references only, never PII.
      await writeAccessLedger(tx, {
        event: 'recovery.guardian_routed',
        actorAccountId: ctx.account.id,
        realActorAccountId: ctx.session.impersonation?.real_actor_account_id ?? null,
        subjectAccountId: studentAccountId,
        guardianAccountId,
        chapterId,
        clientIp: opts.clientIp ?? null,
        detail: { purpose: 'minor_setup', route: 'guardian' },
      })
    })

    return { studentAccountId, setupToken: token, expiresAt, guardianAccountId, route: 'guardian' }
  }

  // ---- redeem (POST /api/setup/student/:token; UNAUTHENTICATED, token-gated) --
  /**
   * The child redeems the one-time `minor_setup` credential (with the guardian
   * present), setting the account's argon2id password. Token-gated and actor-less
   * (like invite accept / password reset), so NO `authorize`: the gate is the
   * opaque token. The account KEEPS its system username and STAYS `pending` — no
   * membership is activated here (activation is the director's separate step).
   * Validity (live/unexpired/unconsumed) is evaluated at REQUEST time; an expired,
   * consumed, or unknown token is one opaque InvalidCredentialTokenError. Single-use:
   * the claim UPDATE re-checks validity under the row, so a token consumed between
   * the read and the write loses the race.
   *
   * OPTIONALLY sets the student's hidden, outbound-only `notification_email` (the
   * child, with the guardian present at setup, entering the address the guardian's
   * signed grant authorized). This is refused with
   * StudentNotificationEmailNotAuthorizedError unless ALL hold: the global flag
   * STUDENT_NOTIFICATION_EMAIL_ENABLED is on, a current `student_notification_email`
   * grant is active, AND the student is 13+ — otherwise the field stays null. With
   * the flag off it is always refused (the feature is DARK). When no
   * `notificationEmail` is supplied the redemption is a password-only setup, exactly
   * as before. COUNSEL-GATED: enabling makes a minor directly contactable.
   */
  async redeemSetupCredential(
    token: string,
    newPassword: string,
    opts: { now?: Date; notificationEmail?: string | null } = {},
  ): Promise<RedeemSetupCredentialResult> {
    const now = opts.now ?? new Date()
    const notificationEmail = opts.notificationEmail ?? null
    const tokenHash = hashToken(token)
    const [row] = await this.sql`
      select id, account_id from credential_token
      where token_hash = ${tokenHash} and purpose = 'minor_setup'
        and consumed_at is null and expires_at > ${now}
    `
    if (row === undefined) throw new InvalidCredentialTokenError()

    const accountId = row.account_id as string

    // If a notification_email is being set, its full authorization chain must hold
    // BEFORE any write (the whole feature is dark with the flag off). Any missing
    // condition is one opaque refusal — the field simply stays null.
    if (notificationEmail !== null) {
      if (!this.config.studentNotificationEmailEnabled) {
        throw new StudentNotificationEmailNotAuthorizedError(accountId)
      }
      const [acct] = await this.sql`select date_of_birth as dob from account where id = ${accountId}`
      const age = acct === undefined ? 0 : ageInYears(new Date(acct.dob as string), now)
      const grantActive = await hasActiveGrant(this.sql, accountId, 'student_notification_email', now)
      if (age < 13 || !grantActive) {
        throw new StudentNotificationEmailNotAuthorizedError(accountId)
      }
    }

    // Hash after the validity pre-check (skip the cost for a clearly-invalid token).
    const passwordHash = await hashPassword(newPassword)

    return this.sql.begin(async (tx) => {
      // Claim atomically: single-use, rejects a token consumed/expired since the read.
      const claimed = await tx`
        update credential_token set consumed_at = ${now}
        where id = ${row.id} and consumed_at is null and expires_at > ${now}
        returning account_id
      `
      if (claimed.length === 0) throw new InvalidCredentialTokenError()

      // Set the password; the account keeps its system username and stays pending
      // (no membership activation here). No sessions to revoke (the shell had none).
      await tx`update account set password_hash = ${passwordHash} where id = ${accountId}`

      // Set the authorized notification_email in the SAME transaction. This does NOT
      // touch the login identity: `email` stays null, `username` stays set.
      if (notificationEmail !== null) {
        await tx`update account set notification_email = ${notificationEmail} where id = ${accountId}`
      }

      return { accountId }
    }) as Promise<RedeemSetupCredentialResult>
  }

  /** The setup-credential lifetime in ms — the family (guardian/student) window. */
  private setupTtlMs(): number {
    return this.config.inviteTtlMsByKind.student ?? this.config.inviteTtlMs
  }
}
