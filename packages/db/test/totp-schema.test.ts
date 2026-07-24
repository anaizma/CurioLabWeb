// -------------------------------------------------------------------------
// §10 TOTP two-factor — schema guarantees (migration 0023_totp_2fa.sql).
//
// The additive migration adds the per-account TOTP secret + activation +
// replay-guard columns, the one-time backup-code table, the attempt-log table
// (rate limiting), and the `totp_pending` credential-token purpose (the
// short-lived pending-2FA login state). Red-before-green witnesses:
//   * account.totp_secret / totp_activated_at / totp_last_step exist, nullable;
//   * totp_backup_code: account FK, code_hash NOT NULL, consumed_at nullable;
//     app role may SELECT/INSERT/UPDATE (consume), analytics denied SELECT;
//   * totp_attempt: account FK, success NOT NULL; app SELECT/INSERT;
//   * credential_token_purpose gained 'totp_pending'.
//
// TDD: CURIOLAB_MIGRATE_UPTO=0022 witnesses the red state (0023 absent).
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

async function makeAccount(): Promise<string> {
  const [row] = await h.sql`
    insert into account (
      email, legal_name, display_name, date_of_birth,
      dob_provenance, credential_owner, status, maturation_state
    ) values (
      ${`al-${randomUUID().slice(0, 8)}@example.test`}, 'Adult Testperson', 'Adult T.',
      '1990-01-01', 'staff_entered', 'self_private', 'active', 'self_managed'
    ) returning id
  `
  return row!.id as string
}

describe('account TOTP columns', () => {
  test('totp_secret / totp_activated_at / totp_last_step default null and are writable', async () => {
    const acct = await makeAccount()
    const [before] = await h.sql`
      select totp_secret, totp_activated_at, totp_last_step from account where id = ${acct}
    `
    expect(before!.totp_secret).toBeNull()
    expect(before!.totp_activated_at).toBeNull()
    expect(before!.totp_last_step).toBeNull()

    await h.sql`
      update account set totp_secret = 'JBSWY3DPEHPK3PXP', totp_activated_at = now(), totp_last_step = 56789
      where id = ${acct}
    `
    const [after] = await h.sql`
      select totp_secret, totp_activated_at, totp_last_step from account where id = ${acct}
    `
    expect(after!.totp_secret).toBe('JBSWY3DPEHPK3PXP')
    expect(after!.totp_activated_at).not.toBeNull()
    expect(String(after!.totp_last_step)).toBe('56789')
  })
})

describe('totp_backup_code', () => {
  test('a code row references an account and stores a hash, consumed_at null by default', async () => {
    const acct = await makeAccount()
    const [row] = await h.sql`
      insert into totp_backup_code (account_id, code_hash) values (${acct}, ${'$argon2id$fake'})
      returning id, consumed_at, created_at
    `
    expect(row!.id).toBeTruthy()
    expect(row!.consumed_at).toBeNull()
    expect(row!.created_at).not.toBeNull()
  })

  test('account_id is FK-checked and code_hash is NOT NULL', async () => {
    await expect(h.sql`
      insert into totp_backup_code (account_id, code_hash) values (${randomUUID()}, 'x')
    `).rejects.toThrow(/foreign key|violates/i)
    const acct = await makeAccount()
    await expect(h.sql`
      insert into totp_backup_code (account_id, code_hash) values (${acct}, ${null})
    `).rejects.toThrow(/null value|not-null/i)
  })

  test('the app role may INSERT, SELECT, and UPDATE (consume); analytics is denied SELECT', async () => {
    const acct = await makeAccount()
    const app = h.connectAs('curiolab_app', 'app_pw')
    const rows = await app`insert into totp_backup_code (account_id, code_hash) values (${acct}, 'h') returning id`
    const id = rows[0]!.id as string
    // Consume (UPDATE) is allowed — a backup code is single-use.
    const upd = await app`update totp_backup_code set consumed_at = now() where id = ${id} returning id`
    expect(upd.length).toBe(1)
    const analytics = h.connectAs('curiolab_analytics', 'analytics_pw')
    await expect(analytics`select 1 from totp_backup_code limit 1`).rejects.toThrow(/permission denied/i)
  })
})

describe('totp_attempt (rate limiting)', () => {
  test('records an attempt with a success flag and a timestamp', async () => {
    const acct = await makeAccount()
    const [row] = await h.sql`
      insert into totp_attempt (account_id, success) values (${acct}, false) returning id, at, success
    `
    expect(row!.id).toBeTruthy()
    expect(row!.at).not.toBeNull()
    expect(row!.success).toBe(false)
  })

  test('success is NOT NULL', async () => {
    const acct = await makeAccount()
    await expect(h.sql`
      insert into totp_attempt (account_id, success) values (${acct}, ${null})
    `).rejects.toThrow(/null value|not-null/i)
  })

  test('the app role may INSERT and SELECT; analytics is denied SELECT', async () => {
    const acct = await makeAccount()
    const app = h.connectAs('curiolab_app', 'app_pw')
    const rows = await app`insert into totp_attempt (account_id, success) values (${acct}, true) returning id`
    expect(rows.length).toBe(1)
    const read = await app`select id from totp_attempt where account_id = ${acct}`
    expect(read.length).toBeGreaterThan(0)
    const analytics = h.connectAs('curiolab_analytics', 'analytics_pw')
    await expect(analytics`select 1 from totp_attempt limit 1`).rejects.toThrow(/permission denied/i)
  })
})

describe('credential_token_purpose enum', () => {
  test('gained the totp_pending value (the pending-2FA login state)', async () => {
    const acct = await makeAccount()
    const [row] = await h.sql`
      insert into credential_token (account_id, token_hash, purpose, expires_at)
      values (${acct}, ${`h-${randomUUID()}`}, 'totp_pending', now() + interval '5 minutes')
      returning id, purpose
    `
    expect(row!.purpose).toBe('totp_pending')
  })
})
