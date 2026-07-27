// -------------------------------------------------------------------------
// CredentialTokenService — the issue/consume services over the credential_token
// store (migration 0019). Backs password reset (05-api-surface.md POST
// /auth/password/reset-request, /reset). Account recovery's issue lives on
// MaturationService.reissueSetup (it is `account.recover`-gated); its consume
// (consumeAccountRecovery) also lives there. This service owns the password-reset
// pair, which has no actor and no capability — it is token-gated end to end, like
// invite accept.
//
// Tokens follow the runtime CSPRNG + hash pattern (tokens.ts): a high-entropy
// opaque token is returned to the caller ONCE (the seam a future mailer consumes),
// and ONLY its SHA-256 hash is stored. Passwords are argon2id (password.ts).
// Validity (live/unexpired/unconsumed) is evaluated at DECISION TIME against a
// caller-supplied `now`, never a sweeper — a token goes invalid the instant it
// should (mirroring sessions/invites).
//
// NO-ORACLE: issuePasswordReset returns null for an unknown identifier (it mints
// and persists nothing). The controller returns its uniform response regardless,
// so the persisted-token side effect never becomes an existence oracle.
//
// Framework-agnostic: the db handle and config are injected; the HTTP routes are
// wired in @curiolab/http. Token/email DELIVERY is a mailer seam (the returned
// token + route); this layer builds the store + consume logic, not the mailer.
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import type { CredentialOwner } from '@curiolab/core'
import { passwordPolicyProblems } from '@curiolab/core'
import {
  generateSessionToken,
  hashPassword,
  hashToken,
  revokeAllSessionsForAccount,
} from '@curiolab/runtime'
import { type AppConfig, defaultConfig } from './config.js'
import { passwordResetRoute } from './maturation.js'
import { InvalidCredentialTokenError, WeakPasswordError } from './errors.js'

/**
 * The single gate every password WRITE in this service passes. It lives here, at
 * the service, rather than only at the HTTP edge or in the form, because this is
 * the layer that actually calls hashPassword: a caller that bypasses the route
 * still cannot write a password below policy.
 */
function assertPasswordPolicy(password: string): void {
  const problems = passwordPolicyProblems(password)
  if (problems.length > 0) throw new WeakPasswordError(problems)
}

export interface CredentialTokenServiceDeps {
  sql: Sql
  /** Optional overrides for the config-not-code tunables (e.g. the reset TTL). */
  config?: Partial<AppConfig>
}

/**
 * Where a reset for one account is delivered (the seam a future mailer consumes):
 * an adult -> their own email; a minor -> their verified guardians, or the Chapter
 * Director for a `self_private` account (06-onboarding-flows; the reset-routing
 * decision `passwordResetRoute` for the minor split).
 */
export type PasswordResetRoute = 'self_email' | 'guardian' | 'chapter_director'

export interface IssuePasswordResetResult {
  accountId: string
  /** The opaque token, returned to the caller exactly once. Never stored raw. */
  token: string
  expiresAt: Date
  /** The delivery route handed to the mailer seam. */
  route: PasswordResetRoute
}

export interface ConsumePasswordResetResult {
  accountId: string
}

export interface IssuePasswordChangeRequiredResult {
  accountId: string
  /** The opaque token, returned to the caller exactly once. Never stored raw. */
  token: string
  expiresAt: Date
}

export interface ConsumePasswordChangeRequiredResult {
  accountId: string
}

export class CredentialTokenService {
  private readonly sql: Sql
  private readonly config: AppConfig

  constructor(deps: CredentialTokenServiceDeps) {
    this.sql = deps.sql
    this.config = { ...defaultConfig, ...deps.config }
  }

  // ---- issue (POST /auth/password/reset-request) ---------------------------
  /**
   * Resolve the account by email OR username; mint a CSPRNG token (raw returned
   * once, only the hash stored), purpose 'password_reset', expires_at = now + the
   * configured TTL; return the token + the delivery route for the mailer seam. A
   * regenerate REVOKES the prior: any prior LIVE password_reset token for the
   * account is superseded (its consumed_at stamped) before the fresh insert, so
   * the one-live-per-(account,purpose) index holds. Returns null for an unknown
   * identifier (mints and persists nothing) — the controller stays uniform.
   */
  async issuePasswordReset(
    accountIdentifier: string,
    opts: { now?: Date } = {},
  ): Promise<IssuePasswordResetResult | null> {
    const now = opts.now ?? new Date()
    const nowDate = now.toISOString().slice(0, 10)
    const [acct] = await this.sql`
      select id, credential_owner,
             (date_of_birth + interval '18 years' <= ${nowDate}::date) as is_adult
      from account
      where (email = ${accountIdentifier} or username = ${accountIdentifier})
      limit 1
    `
    if (acct === undefined) return null

    const accountId = acct.id as string
    const route: PasswordResetRoute =
      acct.is_adult === true
        ? 'self_email'
        : passwordResetRoute(acct.credential_owner as CredentialOwner)

    const token = generateSessionToken()
    const tokenHash = hashToken(token)
    const expiresAt = new Date(now.getTime() + this.config.passwordResetTtlMs)

    await this.sql.begin(async (tx) => {
      // Regenerate revokes the prior: supersede any live password_reset token so
      // the one-live-per-purpose partial unique index admits the fresh insert.
      await tx`
        update credential_token set consumed_at = ${now}
        where account_id = ${accountId} and purpose = 'password_reset' and consumed_at is null
      `
      await tx`
        insert into credential_token (account_id, token_hash, purpose, expires_at)
        values (${accountId}, ${tokenHash}, 'password_reset', ${expiresAt})
      `
    })

    return { accountId, token, expiresAt, route }
  }

  // ---- check (the reset FORM's server-side pre-flight) ---------------------
  /**
   * Is this reset token usable right now? A READ, deliberately: the page behind a
   * reset link has to distinguish "type your new password" from "this link has
   * expired or has already been used" BEFORE the person composes a password, and
   * the only alternative would be to consume the token to find out.
   *
   * It is not an oracle: the token is high-entropy and unguessable, so the only
   * caller who can ask about a token is the one already holding it, and the two
   * not-usable causes (expired, consumed, never existed) are one answer.
   */
  async checkPasswordReset(token: string, opts: { now?: Date } = {}): Promise<boolean> {
    const now = opts.now ?? new Date()
    const [row] = await this.sql`
      select 1 from credential_token
      where token_hash = ${hashToken(token)} and purpose = 'password_reset'
        and consumed_at is null and expires_at > ${now}
    `
    return row !== undefined
  }

  // ---- consume (POST /auth/password/reset) ---------------------------------
  /**
   * Validate (live, unexpired, unconsumed) at request time; set the account's
   * argon2id password_hash; mark consumed_at; revoke the account's existing
   * sessions (a reset invalidates old sessions — must-not #30). Rejects an
   * expired, consumed, or unknown token with one opaque InvalidCredentialTokenError.
   * The claim UPDATE re-checks validity under the row, so a token that lapsed or
   * was consumed between the read and the write loses the race and is rejected.
   */
  async consumePasswordReset(
    token: string,
    newPassword: string,
    opts: { now?: Date } = {},
  ): Promise<ConsumePasswordResetResult> {
    const now = opts.now ?? new Date()
    const tokenHash = hashToken(token)
    const [row] = await this.sql`
      select id, account_id from credential_token
      where token_hash = ${tokenHash} and purpose = 'password_reset'
        and consumed_at is null and expires_at > ${now}
    `
    if (row === undefined) throw new InvalidCredentialTokenError()

    const accountId = row.account_id as string
    // Policy BEFORE hashing: a weak password should cost neither an argon2id pass
    // nor the token, so the person can simply try a stronger one on the same link.
    assertPasswordPolicy(newPassword)
    // Hash after the validity pre-check (skip the cost for a clearly-invalid token).
    const passwordHash = await hashPassword(newPassword)

    return this.sql.begin(async (tx) => {
      // Claim atomically: single-use, and rejects a token consumed or expired
      // between the read above and here.
      const claimed = await tx`
        update credential_token set consumed_at = ${now}
        where id = ${row.id} and consumed_at is null and expires_at > ${now}
        returning account_id
      `
      if (claimed.length === 0) throw new InvalidCredentialTokenError()

      await tx`update account set password_hash = ${passwordHash} where id = ${accountId}`
      // A reset invalidates old sessions: revoke both the account's sessions and
      // any impersonation targeting it (revokeAllSessionsForAccount).
      await revokeAllSessionsForAccount(tx, accountId, now)

      return { accountId }
    }) as Promise<ConsumePasswordResetResult>
  }

  // ---- forced password change (migration 0040) -----------------------------
  /**
   * Mint a short-lived 'password_change_required' token for `accountId` (the
   * caller — login() — already resolved the account; unlike issuePasswordReset
   * there is no identifier lookup or no-oracle concern here, since the caller
   * is not exposed to an unauthenticated actor). A regenerate supersedes any
   * prior live token of this purpose, mirroring issuePasswordReset.
   */
  async issuePasswordChangeRequired(
    accountId: string,
    opts: { now?: Date } = {},
  ): Promise<IssuePasswordChangeRequiredResult> {
    const now = opts.now ?? new Date()
    const token = generateSessionToken()
    const tokenHash = hashToken(token)
    const expiresAt = new Date(now.getTime() + this.config.passwordChangeRequiredTtlMs)

    await this.sql.begin(async (tx) => {
      await tx`
        update credential_token set consumed_at = ${now}
        where account_id = ${accountId} and purpose = 'password_change_required' and consumed_at is null
      `
      await tx`
        insert into credential_token (account_id, token_hash, purpose, expires_at)
        values (${accountId}, ${tokenHash}, 'password_change_required', ${expiresAt})
      `
    })

    return { accountId, token, expiresAt }
  }

  /**
   * Validate (live, unexpired, unconsumed) at request time; set the account's
   * argon2id password_hash; CLEAR must_change_password; mark consumed_at;
   * revoke the account's existing sessions (mirrors consumePasswordReset — in
   * the ordinary bootstrap-admin case no session exists yet, but the revoke is
   * harmless and keeps the two consume paths symmetric). Mints NO session: the
   * caller must log in again with the new password.
   */
  async consumePasswordChangeRequired(
    token: string,
    newPassword: string,
    opts: { now?: Date } = {},
  ): Promise<ConsumePasswordChangeRequiredResult> {
    const now = opts.now ?? new Date()
    const tokenHash = hashToken(token)
    const [row] = await this.sql`
      select id, account_id from credential_token
      where token_hash = ${tokenHash} and purpose = 'password_change_required'
        and consumed_at is null and expires_at > ${now}
    `
    if (row === undefined) throw new InvalidCredentialTokenError()

    const accountId = row.account_id as string
    // Same order as consumePasswordReset: policy first, so a weak password costs
    // neither the argon2id pass nor the one-shot token.
    assertPasswordPolicy(newPassword)
    const passwordHash = await hashPassword(newPassword)

    return this.sql.begin(async (tx) => {
      const claimed = await tx`
        update credential_token set consumed_at = ${now}
        where id = ${row.id} and consumed_at is null and expires_at > ${now}
        returning account_id
      `
      if (claimed.length === 0) throw new InvalidCredentialTokenError()

      await tx`
        update account set password_hash = ${passwordHash}, must_change_password = false
        where id = ${accountId}
      `
      await revokeAllSessionsForAccount(tx, accountId, now)

      return { accountId }
    }) as Promise<ConsumePasswordChangeRequiredResult>
  }
}
