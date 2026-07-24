// -------------------------------------------------------------------------
// §10 TwoFactorService — TOTP enrollment, second-factor verification, backup
// codes, the replay guard, the rate limit, and the pending-2FA login token.
// Embedded Postgres, synthetic data only.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { totp } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { TwoFactorService } from '../src/two-factor.js'
import {
  InvalidTotpCodeError,
  TotpAlreadyActivatedError,
  TotpNotActivatedError,
  TotpRateLimitedError,
} from '../src/errors.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

async function makeAccount(): Promise<string> {
  const [row] = await h.sql`
    insert into account (
      email, legal_name, display_name, date_of_birth,
      dob_provenance, credential_owner, status, maturation_state
    ) values (
      ${`al-${randomUUID().slice(0, 8)}@example.test`}, 'Director Testperson', 'Director T.',
      '1985-01-01', 'staff_entered', 'self_private', 'active', 'self_managed'
    ) returning id
  `
  return row!.id as string
}

function svc(): TwoFactorService {
  return new TwoFactorService({ sql: h.sql })
}

const NOW = new Date('2026-07-24T12:00:00Z')

describe('enrollment', () => {
  test('begin returns a secret + otpauth URI; the account is not yet active', async () => {
    const acct = await makeAccount()
    const { secret, otpauthUri } = await svc().beginEnrollment(acct, { now: NOW })
    expect(secret).toMatch(/^[A-Z2-7]+$/)
    expect(otpauthUri).toContain(`secret=${secret}`)
    expect(await svc().isActivated(acct)).toBe(false)
  })

  test('confirm with a correct code activates and returns backup codes once', async () => {
    const acct = await makeAccount()
    const { secret } = await svc().beginEnrollment(acct, { now: NOW })
    const code = totp(secret, NOW.getTime())
    const { backupCodes } = await svc().confirmEnrollment(acct, code, { now: NOW })
    expect(backupCodes).toHaveLength(10)
    expect(await svc().isActivated(acct)).toBe(true)
    // The plaintext codes are never stored — only argon2id hashes.
    const stored = await h.sql`select code_hash from totp_backup_code where account_id = ${acct}`
    expect(stored).toHaveLength(10)
    for (const r of stored) expect(String(r.code_hash)).not.toBe(backupCodes[0])
    // Enrollment is recorded in the access ledger.
    const led = await h.sql`select event from access_ledger where subject_account_id = ${acct} and event = 'totp.enrolled'`
    expect(led).toHaveLength(1)
  })

  test('confirm with a wrong code fails and does not activate', async () => {
    const acct = await makeAccount()
    await svc().beginEnrollment(acct, { now: NOW })
    await expect(svc().confirmEnrollment(acct, '000000', { now: NOW })).rejects.toBeInstanceOf(
      InvalidTotpCodeError,
    )
    expect(await svc().isActivated(acct)).toBe(false)
  })

  test('re-enrolling an already-active account is refused', async () => {
    const acct = await makeAccount()
    const { secret } = await svc().beginEnrollment(acct, { now: NOW })
    await svc().confirmEnrollment(acct, totp(secret, NOW.getTime()), { now: NOW })
    await expect(svc().beginEnrollment(acct, { now: NOW })).rejects.toBeInstanceOf(
      TotpAlreadyActivatedError,
    )
  })
})

/** Enroll an account and return its live secret. */
async function enroll(acct: string, now: Date): Promise<string> {
  const { secret } = await svc().beginEnrollment(acct, { now })
  await svc().confirmEnrollment(acct, totp(secret, now.getTime()), { now })
  return secret
}

describe('verifySecondFactor', () => {
  test('a fresh code for the current step validates', async () => {
    const acct = await makeAccount()
    const secret = await enroll(acct, NOW)
    const later = new Date(NOW.getTime() + 60_000)
    const res = await svc().verifySecondFactor(acct, totp(secret, later.getTime()), { now: later })
    expect(res.method).toBe('totp')
  })

  test('a code outside the +/-1 window is rejected', async () => {
    const acct = await makeAccount()
    const secret = await enroll(acct, NOW)
    const later = new Date(NOW.getTime() + 300_000)
    const stale = totp(secret, later.getTime() - 120_000) // 4 steps earlier
    await expect(svc().verifySecondFactor(acct, stale, { now: later })).rejects.toBeInstanceOf(
      InvalidTotpCodeError,
    )
  })

  test('replay of the same step is rejected (the replay guard)', async () => {
    const acct = await makeAccount()
    const secret = await enroll(acct, NOW)
    const later = new Date(NOW.getTime() + 60_000)
    const code = totp(secret, later.getTime())
    const first = await svc().verifySecondFactor(acct, code, { now: later })
    expect(first.method).toBe('totp')
    // Same code, same time-step: a replay must fail.
    await expect(svc().verifySecondFactor(acct, code, { now: later })).rejects.toBeInstanceOf(
      InvalidTotpCodeError,
    )
  })

  test('a backup code works once, then is consumed', async () => {
    const acct = await makeAccount()
    const { secret } = await svc().beginEnrollment(acct, { now: NOW })
    const { backupCodes } = await svc().confirmEnrollment(acct, totp(secret, NOW.getTime()), { now: NOW })
    const later = new Date(NOW.getTime() + 60_000)
    const res = await svc().verifySecondFactor(acct, backupCodes[0]!, { now: later })
    expect(res.method).toBe('backup_code')
    // Second use of the same backup code fails.
    await expect(svc().verifySecondFactor(acct, backupCodes[0]!, { now: later })).rejects.toBeInstanceOf(
      InvalidTotpCodeError,
    )
  })

  test('verifying against a non-enrolled account is TotpNotActivatedError', async () => {
    const acct = await makeAccount()
    await expect(svc().verifySecondFactor(acct, '000000', { now: NOW })).rejects.toBeInstanceOf(
      TotpNotActivatedError,
    )
  })

  test('attempts are rate-limited after too many failures', async () => {
    const acct = await makeAccount()
    await enroll(acct, NOW)
    const later = new Date(NOW.getTime() + 60_000)
    // Five wrong codes exhaust the window budget (max 5).
    for (let i = 0; i < 5; i++) {
      await expect(svc().verifySecondFactor(acct, '111111', { now: later })).rejects.toBeInstanceOf(
        InvalidTotpCodeError,
      )
    }
    // The sixth attempt is rate-limited even though it is a correct code.
    const secret = (await h.sql`select totp_secret from account where id = ${acct}`)[0]!.totp_secret as string
    await expect(
      svc().verifySecondFactor(acct, totp(secret, later.getTime()), { now: later }),
    ).rejects.toBeInstanceOf(TotpRateLimitedError)
  })
})

describe('pending-2FA login token', () => {
  test('issue -> resolve returns the account; consume makes it unusable', async () => {
    const acct = await makeAccount()
    const { token } = await svc().issuePendingLogin(acct, { now: NOW })
    expect(await svc().resolvePendingLogin(token, { now: NOW })).toBe(acct)
    await svc().consumePendingLogin(token, { now: NOW })
    await expect(svc().resolvePendingLogin(token, { now: NOW })).rejects.toThrow()
  })

  test('an expired pending token does not resolve', async () => {
    const acct = await makeAccount()
    const { token } = await svc().issuePendingLogin(acct, { now: NOW })
    const wayLater = new Date(NOW.getTime() + 60 * 60 * 1000)
    await expect(svc().resolvePendingLogin(token, { now: wayLater })).rejects.toThrow()
  })
})
