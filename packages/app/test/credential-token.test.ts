// -------------------------------------------------------------------------
// CredentialTokenService tests (password reset issue + consume). Embedded
// Postgres, synthetic data only. 05-api-surface.md POST /auth/password/
// reset-request, /reset.
//
//   - issuePasswordReset resolves the account (email OR username), mints a
//     CSPRNG token (raw returned once, only the hash stored), purpose
//     'password_reset', expires_at = now + a configurable TTL, and returns the
//     delivery route for the mailer seam. An unknown identifier returns null
//     (the controller keeps a uniform no-oracle response).
//   - a regenerate REVOKES the prior: a second issue supersedes the first live
//     token (the one-live-per-purpose policy).
//   - consumePasswordReset validates (live/unexpired/unconsumed) at request time,
//     sets the account's argon2id password_hash, marks consumed_at, and revokes
//     the account's existing sessions. A second consume, an expired token, and an
//     unknown token are all rejected opaquely.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createSession, validateSession, verifyPassword, hashToken } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeMinor } from './helpers/fixtures.js'
import { CredentialTokenService, InvalidCredentialTokenError } from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

function svc() {
  return new CredentialTokenService({ sql: h.sql })
}

async function usernameOf(accountId: string): Promise<string> {
  const [row] = await h.sql`select username from account where id = ${accountId}`
  return row!.username as string
}
async function liveTokenCount(accountId: string): Promise<number> {
  const [row] = await h.sql`
    select count(*)::int as n from credential_token
    where account_id = ${accountId} and purpose = 'password_reset' and consumed_at is null
  `
  return row!.n as number
}

// ===========================================================================
describe('issuePasswordReset', () => {
  test('an unknown identifier issues nothing and returns null (no oracle at the service)', async () => {
    const r = await svc().issuePasswordReset(`nobody-${randomUUID().slice(0, 8)}@example.test`)
    expect(r).toBeNull()
  })

  test('an existing identifier mints a token, stores only its hash, and persists one live row', async () => {
    const email = `reset-${randomUUID().slice(0, 8)}@example.test`
    const acct = await makeAdult(h.sql, { email })

    const r = await svc().issuePasswordReset(email)
    expect(r).not.toBeNull()
    expect(r!.token).toBeTruthy()
    expect(r!.accountId).toBe(acct)

    // Only the HASH is stored — the raw token is nowhere in the row.
    const [row] = await h.sql`
      select token_hash, purpose, consumed_at from credential_token where account_id = ${acct}
    `
    expect(row!.token_hash).toBe(hashToken(r!.token))
    expect(row!.token_hash).not.toBe(r!.token)
    expect(row!.purpose).toBe('password_reset')
    expect(row!.consumed_at).toBeNull()
    expect(await liveTokenCount(acct)).toBe(1)
  })

  test('a regenerate REVOKES the prior: a second issue supersedes the first live token', async () => {
    const email = `regen-${randomUUID().slice(0, 8)}@example.test`
    const acct = await makeAdult(h.sql, { email })

    const first = await svc().issuePasswordReset(email)
    const second = await svc().issuePasswordReset(email)
    expect(second!.token).not.toBe(first!.token)
    // Exactly one live token — the first is now consumed (superseded).
    expect(await liveTokenCount(acct)).toBe(1)
    // The old token no longer consumes.
    await expect(svc().consumePasswordReset(first!.token, 'NewPass!234')).rejects.toBeInstanceOf(
      InvalidCredentialTokenError,
    )
  })

  test('expires_at honours the configured TTL', async () => {
    const email = `ttl-${randomUUID().slice(0, 8)}@example.test`
    await makeAdult(h.sql, { email })
    const now = new Date('2026-07-01T00:00:00Z')
    const r = await new CredentialTokenService({ sql: h.sql, config: { passwordResetTtlMs: 60_000 } })
      .issuePasswordReset(email, { now })
    expect(r!.expiresAt.getTime()).toBe(now.getTime() + 60_000)
  })
})

// ===========================================================================
describe('issuePasswordReset — the delivery route (the mailer seam)', () => {
  test('an adult routes to their own email', async () => {
    const email = `adult-${randomUUID().slice(0, 8)}@example.test`
    await makeAdult(h.sql, { email, dateOfBirth: '1990-01-01' })
    const r = await svc().issuePasswordReset(email)
    expect(r!.route).toBe('self_email')
  })

  test('a guardian_provisioned minor routes to the guardians', async () => {
    const minor = await makeMinor(h.sql, { dateOfBirth: '2015-06-01' })
    const r = await svc().issuePasswordReset(await usernameOf(minor))
    expect(r!.route).toBe('guardian')
  })

  test('a self_private minor routes to the chapter_director', async () => {
    const minor = await makeMinor(h.sql, { credentialOwner: 'self_private', dateOfBirth: '2009-06-01' })
    const r = await svc().issuePasswordReset(await usernameOf(minor))
    expect(r!.route).toBe('chapter_director')
  })
})

// ===========================================================================
describe('consumePasswordReset', () => {
  test('sets the argon2id password, marks the token consumed, and revokes prior sessions', async () => {
    const email = `consume-${randomUUID().slice(0, 8)}@example.test`
    const acct = await makeAdult(h.sql, { email })
    // A live session that must die on reset.
    const { token: sessionToken } = await createSession(h.sql, {
      accountId: acct,
      expiresAt: new Date(Date.now() + 3_600_000),
    })
    expect(await validateSession(h.sql, sessionToken)).not.toBeNull()

    const issued = await svc().issuePasswordReset(email)
    const newPassword = 'BrandNewSecret!42'
    const res = await svc().consumePasswordReset(issued!.token, newPassword)
    expect(res.accountId).toBe(acct)

    // The new password verifies against the stored argon2id hash.
    const [a] = await h.sql`select password_hash from account where id = ${acct}`
    expect(await verifyPassword(a!.password_hash as string, newPassword)).toBe(true)

    // The token is consumed.
    expect(await liveTokenCount(acct)).toBe(0)
    const [t] = await h.sql`select consumed_at from credential_token where account_id = ${acct}`
    expect(t!.consumed_at).not.toBeNull()

    // The prior session is revoked (a reset invalidates old sessions).
    expect(await validateSession(h.sql, sessionToken)).toBeNull()
  })

  test('a second consume of the same token is rejected', async () => {
    const email = `twice-${randomUUID().slice(0, 8)}@example.test`
    await makeAdult(h.sql, { email })
    const issued = await svc().issuePasswordReset(email)
    await svc().consumePasswordReset(issued!.token, 'FirstPass!11')
    await expect(svc().consumePasswordReset(issued!.token, 'SecondPass!22')).rejects.toBeInstanceOf(
      InvalidCredentialTokenError,
    )
  })

  test('an expired token is rejected (validity is evaluated at request time)', async () => {
    const email = `expired-${randomUUID().slice(0, 8)}@example.test`
    await makeAdult(h.sql, { email })
    const past = new Date('2020-01-01T00:00:00Z')
    const issued = await new CredentialTokenService({
      sql: h.sql,
      config: { passwordResetTtlMs: 60_000 },
    }).issuePasswordReset(email, { now: past })
    await expect(svc().consumePasswordReset(issued!.token, 'AnyPass!33')).rejects.toBeInstanceOf(
      InvalidCredentialTokenError,
    )
  })

  test('an unknown token is rejected', async () => {
    await expect(svc().consumePasswordReset(`forged-${randomUUID()}`, 'AnyPass!44')).rejects.toBeInstanceOf(
      InvalidCredentialTokenError,
    )
  })
})
