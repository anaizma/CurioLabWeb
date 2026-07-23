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
import {
  generateSessionToken,
  hashPassword,
  hashToken,
  revokeAllSessionsForAccount,
} from '@curiolab/runtime'
import { type AppConfig, defaultConfig } from './config.js'
import { passwordResetRoute } from './maturation.js'
import { InvalidCredentialTokenError } from './errors.js'

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
}
