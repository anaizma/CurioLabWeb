// -------------------------------------------------------------------------
// Milestone M1 (M5 in-flight) — credential_token schema guarantees.
//
// The additive migration 0019_credential_token.sql adds the credential_token
// store that backs password reset and account recovery (05-api-surface.md
// POST /auth/password/reset-request, /reset; 06-onboarding-flows Flow D
// reissueSetup/account.recover). A token is minted CSPRNG, only its hash stored;
// it is consumed once and never rewound. These tests are the red-before-green
// witnesses for the migration's guarantees:
//   * a valid token inserts; consumed_at defaults null; purpose is an enum and
//     an invalid value is rejected; account_id is NOT NULL and FK-checked;
//   * token_hash is globally unique (the secret indexes lookups);
//   * the partial unique index (account_id, purpose) WHERE consumed_at IS NULL —
//     at most ONE live token per (account, purpose): a second live token for the
//     same (account, purpose) is rejected, a consumed one frees the slot
//     (re-issue after consume succeeds), and the two purposes are independent;
//   * the Mechanism-A grants (app DML; analytics default-deny — the token backs
//     identity recovery, so the analytics read role must not reach it directly,
//     matching verification_token).
//
// TDD: run with CURIOLAB_MIGRATE_UPTO=0018 to witness these fail (the relation
// does not exist yet); the default run applies 0019 and they pass. Reuses the
// shared embedded-Postgres harness exactly like the other *-schema tests.
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

/** A synthetic adult account to hang tokens on. */
async function makeAccount(): Promise<string> {
  const [row] = await h.sql`
    insert into account (
      email, username, legal_name, display_name, date_of_birth,
      dob_provenance, dob_source_ref, credential_owner, status, maturation_state
    ) values (
      ${`ct-${randomUUID().slice(0, 8)}@example.test`}, ${null}, 'Adult Testperson', 'Adult T.',
      '1990-01-01', 'self_reported', ${null}, 'self_private', 'active', 'self_managed'
    ) returning id
  `
  return row!.id as string
}

interface TokenOverrides {
  tokenHash?: string
  purpose?: 'password_reset' | 'account_recovery'
  consumedAt?: Date | null
  expiresAt?: Date
}
async function makeToken(accountId: string, o: TokenOverrides = {}): Promise<string> {
  const expiresAt = o.expiresAt ?? new Date(Date.now() + 3_600_000)
  const [row] = await h.sql`
    insert into credential_token (account_id, token_hash, purpose, expires_at, consumed_at)
    values (
      ${accountId}, ${o.tokenHash ?? `hash-${randomUUID()}`}, ${o.purpose ?? 'password_reset'},
      ${expiresAt}, ${o.consumedAt ?? null}
    ) returning id
  `
  return row!.id as string
}

// ---------------------------------------------------------------------------
describe('credential_token enum, defaults, and shape', () => {
  test('a valid token inserts and consumed_at defaults null', async () => {
    const acct = await makeAccount()
    const [row] = await h.sql`
      insert into credential_token (account_id, token_hash, purpose, expires_at)
      values (${acct}, ${`hash-${randomUUID()}`}, 'password_reset', now() + interval '1 hour')
      returning consumed_at, created_at
    `
    expect(row!.consumed_at).toBeNull()
    expect(row!.created_at).not.toBeNull()
  })

  test('an invalid purpose is rejected', async () => {
    const acct = await makeAccount()
    await expect(h.sql`
      insert into credential_token (account_id, token_hash, purpose, expires_at)
      values (${acct}, ${`hash-${randomUUID()}`}, 'bogus', now() + interval '1 hour')
    `).rejects.toThrow(/invalid input value for enum|credential_token_purpose/i)
  })

  test('account_id is NOT NULL', async () => {
    await expect(h.sql`
      insert into credential_token (account_id, token_hash, purpose, expires_at)
      values (${null}, ${`hash-${randomUUID()}`}, 'password_reset', now() + interval '1 hour')
    `).rejects.toThrow(/null value|not-null/i)
  })

  test('account_id is FK-checked against account', async () => {
    await expect(h.sql`
      insert into credential_token (account_id, token_hash, purpose, expires_at)
      values (${randomUUID()}, ${`hash-${randomUUID()}`}, 'password_reset', now() + interval '1 hour')
    `).rejects.toThrow(/foreign key|violates/i)
  })
})

// ---------------------------------------------------------------------------
describe('token_hash global uniqueness', () => {
  test('two tokens cannot share a token_hash', async () => {
    const a = await makeAccount()
    const b = await makeAccount()
    const hash = `hash-${randomUUID()}`
    await makeToken(a, { tokenHash: hash })
    // Even a different account, different purpose cannot reuse the hash.
    await expect(makeToken(b, { tokenHash: hash, purpose: 'account_recovery' })).rejects.toThrow(
      /duplicate key|unique/i,
    )
  })
})

// ---------------------------------------------------------------------------
describe('the partial unique index (account_id, purpose) WHERE consumed_at IS NULL', () => {
  test('a second LIVE token for the same (account, purpose) is rejected', async () => {
    const acct = await makeAccount()
    await makeToken(acct, { purpose: 'password_reset' })
    await expect(makeToken(acct, { purpose: 'password_reset' })).rejects.toThrow(
      /duplicate key|unique/i,
    )
  })

  test('the two purposes are independent: one live token of each is allowed', async () => {
    const acct = await makeAccount()
    await makeToken(acct, { purpose: 'password_reset' })
    const rec = await makeToken(acct, { purpose: 'account_recovery' })
    expect(rec).toBeTruthy()
  })

  test('a consumed token frees the slot: re-issue of the same (account, purpose) succeeds', async () => {
    const acct = await makeAccount()
    const first = await makeToken(acct, { purpose: 'password_reset' })
    // Consume the first, then a fresh live token for the same purpose is fine.
    await h.sql`update credential_token set consumed_at = now() where id = ${first}`
    const second = await makeToken(acct, { purpose: 'password_reset' })
    expect(second).not.toBe(first)
    // Two consumed rows for the same (account, purpose) also coexist (partial index).
    await h.sql`update credential_token set consumed_at = now() where id = ${second}`
    const third = await makeToken(acct, { purpose: 'password_reset' })
    expect(third).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
describe('Mechanism A: grants on credential_token', () => {
  test('the analytics role is denied SELECT (default-deny — it backs identity recovery)', async () => {
    const acct = await makeAccount()
    await makeToken(acct)
    const analytics = h.connectAs('curiolab_analytics', 'analytics_pw')
    await expect(analytics`select 1 from credential_token limit 1`).rejects.toThrow(
      /permission denied/i,
    )
  })

  test('the app role may DML credential_token (control)', async () => {
    const acct = await makeAccount()
    const app = h.connectAs('curiolab_app', 'app_pw')
    const rows = await app`
      insert into credential_token (account_id, token_hash, purpose, expires_at)
      values (${acct}, ${`hash-${randomUUID()}`}, 'account_recovery', now() + interval '1 hour')
      returning id
    `
    expect(rows.length).toBe(1)
    // and may consume (UPDATE) it
    const upd = await app`update credential_token set consumed_at = now() where id = ${rows[0]!.id} returning id`
    expect(upd.length).toBe(1)
  })
})
