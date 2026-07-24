// -------------------------------------------------------------------------
// TwoFactorService — the DB-backed TOTP two-factor layer (admin/director
// backend §10). Framework-agnostic (DI: the db handle + config; a caller-
// supplied `now` for decision-time evaluation), a PEER of CredentialTokenService.
//
// It owns:
//   - enrollment: beginEnrollment (mint + store the secret, return the otpauth
//     URI) and confirmEnrollment (verify a code, activate, mint the one-time
//     backup codes, write the access ledger);
//   - login second factor: verifySecondFactor (a TOTP code with the +/-1 window
//     and the replay guard, OR a one-time backup code), rate-limited at decision
//     time over the recent attempt log;
//   - the pending-2FA login state: issue/resolve/consume a short-lived
//     credential_token (purpose 'totp_pending') that models "password proven, no
//     session yet" without minting a session.
//
// The RFC 6238 crypto lives in @curiolab/runtime (totp.ts); backup codes are
// hashed with argon2id (password.ts). The secret is stored recoverable (it must
// be, to verify a code) — see the at-rest note in runtime/totp.ts + the runbook.
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import {
  generateBackupCodes,
  generateSessionToken,
  generateTotpSecret,
  hashPassword,
  hashToken,
  totpProvisioningUri,
  verifyPassword,
  verifyTotp,
  writeAccessLedger,
} from '@curiolab/runtime'
import { type AppConfig, defaultConfig } from './config.js'
import {
  InvalidCredentialTokenError,
  InvalidTotpCodeError,
  TotpAlreadyActivatedError,
  TotpNotActivatedError,
  TotpRateLimitedError,
  TotpSecretMissingError,
} from './errors.js'

export interface TwoFactorServiceDeps {
  sql: Sql
  config?: Partial<AppConfig>
}

export interface BeginEnrollmentResult {
  /** The base32 shared secret — the frontend also renders the otpauth URI as a QR. */
  secret: string
  /** The otpauth:// provisioning URI the authenticator app imports (no QR server-side). */
  otpauthUri: string
}

export interface ConfirmEnrollmentResult {
  /** The one-time recovery codes, returned ONCE (never re-retrievable). */
  backupCodes: string[]
}

export interface EnrollActivatedResult extends BeginEnrollmentResult, ConfirmEnrollmentResult {}

export interface VerifySecondFactorResult {
  method: 'totp' | 'backup_code'
}

export interface IssuePendingLoginResult {
  token: string
  expiresAt: Date
}

interface OpNow {
  now?: Date
  /** Trusted client IP threaded from the HTTP layer for the access ledger. */
  clientIp?: string | null
}

export class TwoFactorService {
  private readonly sql: Sql
  private readonly config: AppConfig

  constructor(deps: TwoFactorServiceDeps) {
    this.sql = deps.sql
    this.config = { ...defaultConfig, ...deps.config }
  }

  private totpOpts() {
    return {
      step: this.config.totpStepSeconds,
      digits: this.config.totpDigits,
      window: this.config.totpWindowSteps,
    }
  }

  /** True iff the account has an activated TOTP secret. */
  async isActivated(accountId: string): Promise<boolean> {
    const [row] = await this.sql`
      select totp_activated_at from account where id = ${accountId}
    `
    return row !== undefined && row.totp_activated_at != null
  }

  // ---- enrollment ----------------------------------------------------------

  /**
   * Begin enrollment: mint a fresh base32 secret, store it (NOT yet active), and
   * return it + the otpauth:// URI. Refuses if TOTP is already active (a live
   * secret is never rotated out from under the authenticator here).
   */
  async beginEnrollment(accountId: string, _opts: OpNow = {}): Promise<BeginEnrollmentResult> {
    const [acct] = await this.sql`
      select email, username, totp_activated_at from account where id = ${accountId}
    `
    if (acct === undefined) throw new TotpNotActivatedError(accountId)
    if (acct.totp_activated_at != null) throw new TotpAlreadyActivatedError(accountId)

    const secret = generateTotpSecret()
    await this.sql`update account set totp_secret = ${secret} where id = ${accountId}`
    const accountName = (acct.email as string | null) ?? (acct.username as string | null) ?? accountId
    return {
      secret,
      otpauthUri: totpProvisioningUri({
        secret,
        accountName,
        issuer: this.config.totpIssuer,
        digits: this.config.totpDigits,
        period: this.config.totpStepSeconds,
      }),
    }
  }

  /**
   * Confirm enrollment: verify `code` against the pending secret, activate TOTP,
   * seed the replay guard with the matched step, mint + hash the one-time backup
   * codes, and write the `totp.enrolled` access-ledger row. Returns the backup
   * codes ONCE.
   */
  async confirmEnrollment(
    accountId: string,
    code: string,
    opts: OpNow = {},
  ): Promise<ConfirmEnrollmentResult> {
    const now = opts.now ?? new Date()
    const [acct] = await this.sql`
      select totp_secret, totp_activated_at from account where id = ${accountId}
    `
    if (acct === undefined) throw new TotpNotActivatedError(accountId)
    if (acct.totp_activated_at != null) throw new TotpAlreadyActivatedError(accountId)
    const secret = acct.totp_secret as string | null
    if (secret == null) throw new TotpSecretMissingError(accountId)

    // Rate-limit confirm attempts too (defense in depth: the pending token gates
    // this, but a code brute-force within the token window is still refused).
    await this.assertUnderRateLimit(accountId, now)
    const matched = verifyTotp(secret, code, now.getTime(), this.totpOpts())
    if (matched === null) {
      await this.recordAttempt(accountId, false, now)
      throw new InvalidTotpCodeError()
    }

    const backupCodes = generateBackupCodes(this.config.totpBackupCodeCount)
    const hashes = await Promise.all(backupCodes.map((c) => hashPassword(c)))

    await this.sql.begin(async (tx) => {
      await tx`
        update account set totp_activated_at = ${now}, totp_last_step = ${matched}
        where id = ${accountId}
      `
      for (const codeHash of hashes) {
        await tx`insert into totp_backup_code (account_id, code_hash) values (${accountId}, ${codeHash})`
      }
      await writeAccessLedger(tx, {
        event: 'totp.enrolled',
        actorAccountId: accountId,
        subjectAccountId: accountId,
        clientIp: opts.clientIp ?? null,
      })
    })

    return { backupCodes }
  }

  /**
   * Server-side direct enrollment for the bootstrap seed (§2): mint the secret,
   * activate immediately, seed the replay guard, and return the secret + URI +
   * backup codes for the operator to record once. There is no code to confirm
   * because the operator receives the secret out of band.
   */
  async enrollAndActivate(accountId: string, opts: OpNow = {}): Promise<EnrollActivatedResult> {
    const now = opts.now ?? new Date()
    const [acct] = await this.sql`
      select email, username, totp_activated_at from account where id = ${accountId}
    `
    if (acct === undefined) throw new TotpNotActivatedError(accountId)
    if (acct.totp_activated_at != null) throw new TotpAlreadyActivatedError(accountId)

    const secret = generateTotpSecret()
    const currentStep = Math.floor(Math.floor(now.getTime() / 1000) / this.config.totpStepSeconds)
    const backupCodes = generateBackupCodes(this.config.totpBackupCodeCount)
    const hashes = await Promise.all(backupCodes.map((c) => hashPassword(c)))

    await this.sql.begin(async (tx) => {
      await tx`
        update account set totp_secret = ${secret}, totp_activated_at = ${now}, totp_last_step = ${currentStep}
        where id = ${accountId}
      `
      for (const codeHash of hashes) {
        await tx`insert into totp_backup_code (account_id, code_hash) values (${accountId}, ${codeHash})`
      }
      await writeAccessLedger(tx, {
        event: 'totp.enrolled',
        actorAccountId: accountId,
        subjectAccountId: accountId,
        clientIp: opts.clientIp ?? null,
        detail: { via: 'bootstrap' },
      })
    })

    const accountName = (acct.email as string | null) ?? (acct.username as string | null) ?? accountId
    return {
      secret,
      otpauthUri: totpProvisioningUri({
        secret,
        accountName,
        issuer: this.config.totpIssuer,
        digits: this.config.totpDigits,
        period: this.config.totpStepSeconds,
      }),
      backupCodes,
    }
  }

  // ---- login second factor -------------------------------------------------

  /**
   * Verify a second factor at login: a TOTP code (with the +/-1 window and the
   * per-account last-step replay guard) or a one-time backup code (consumed on
   * use). Rate-limited at decision time over the recent attempt log — once the
   * failure budget in the window is spent, further attempts (even a correct code)
   * are refused. Every attempt is logged (success flag) for that count.
   */
  async verifySecondFactor(
    accountId: string,
    code: string,
    opts: OpNow = {},
  ): Promise<VerifySecondFactorResult> {
    const now = opts.now ?? new Date()

    // Rate limit: count recent FAILURES; refuse once the budget is spent.
    await this.assertUnderRateLimit(accountId, now)

    const [acct] = await this.sql`
      select totp_secret, totp_activated_at, totp_last_step from account where id = ${accountId}
    `
    if (acct === undefined || acct.totp_activated_at == null) {
      throw new TotpNotActivatedError(accountId)
    }
    const secret = acct.totp_secret as string
    const lastStep = (acct.totp_last_step as number | null) ?? null

    // 1) TOTP path. A match that is a replay (step <= last consumed) is NOT valid.
    const matched = verifyTotp(secret, code, now.getTime(), this.totpOpts())
    if (matched !== null && (lastStep === null || matched > lastStep)) {
      await this.sql`update account set totp_last_step = ${matched} where id = ${accountId}`
      await this.recordAttempt(accountId, true, now)
      return { method: 'totp' }
    }

    // 2) Backup-code path (only if it was not a TOTP match/replay).
    if (matched === null) {
      const codes = await this.sql`
        select id, code_hash from totp_backup_code
        where account_id = ${accountId} and consumed_at is null
      `
      for (const row of codes) {
        if (await verifyPassword(row.code_hash as string, code)) {
          await this.sql`update totp_backup_code set consumed_at = ${now} where id = ${row.id}`
          await this.recordAttempt(accountId, true, now)
          return { method: 'backup_code' }
        }
      }
    }

    await this.recordAttempt(accountId, false, now)
    throw new InvalidTotpCodeError()
  }

  private async recordAttempt(accountId: string, success: boolean, at: Date): Promise<void> {
    await this.sql`insert into totp_attempt (account_id, success, at) values (${accountId}, ${success}, ${at})`
  }

  /** Throw TotpRateLimitedError when recent failures in the window exceed the cap. */
  private async assertUnderRateLimit(accountId: string, now: Date): Promise<void> {
    const windowStart = new Date(now.getTime() - this.config.totpRateLimitWindowMs)
    const [{ failures }] = (await this.sql`
      select count(*)::int as failures from totp_attempt
      where account_id = ${accountId} and success = false and at >= ${windowStart}
    `) as unknown as [{ failures: number }]
    if (failures >= this.config.totpRateLimitMax) throw new TotpRateLimitedError(accountId)
  }

  // ---- pending-2FA login state (credential_token purpose 'totp_pending') ---

  /**
   * Mint a short-lived pending-2FA login token after a correct password for a
   * privileged account. It is NOT a session (confers no authority). A re-login
   * supersedes any prior live pending token (the one-live-per-purpose slot). Only
   * the token hash is stored.
   */
  async issuePendingLogin(accountId: string, opts: OpNow = {}): Promise<IssuePendingLoginResult> {
    const now = opts.now ?? new Date()
    const token = generateSessionToken()
    const tokenHash = hashToken(token)
    const expiresAt = new Date(now.getTime() + this.config.twoFactorPendingTtlMs)
    await this.sql.begin(async (tx) => {
      await tx`
        update credential_token set consumed_at = ${now}
        where account_id = ${accountId} and purpose = 'totp_pending' and consumed_at is null
      `
      await tx`
        insert into credential_token (account_id, token_hash, purpose, expires_at)
        values (${accountId}, ${tokenHash}, 'totp_pending', ${expiresAt})
      `
    })
    return { token, expiresAt }
  }

  /**
   * Resolve a pending-2FA token to its account id (live, unexpired, unconsumed at
   * decision time), or throw the opaque InvalidCredentialTokenError.
   */
  async resolvePendingLogin(token: string, opts: OpNow = {}): Promise<string> {
    const now = opts.now ?? new Date()
    const [row] = await this.sql`
      select account_id from credential_token
      where token_hash = ${hashToken(token)} and purpose = 'totp_pending'
        and consumed_at is null and expires_at > ${now}
    `
    if (row === undefined) throw new InvalidCredentialTokenError()
    return row.account_id as string
  }

  /** Consume the pending-2FA token (single-use) once the second factor is proven. */
  async consumePendingLogin(token: string, opts: OpNow = {}): Promise<void> {
    const now = opts.now ?? new Date()
    await this.sql`
      update credential_token set consumed_at = ${now}
      where token_hash = ${hashToken(token)} and purpose = 'totp_pending' and consumed_at is null
    `
  }
}
