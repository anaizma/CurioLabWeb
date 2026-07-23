// -------------------------------------------------------------------------
// Password reset + account recovery controllers (05-api-surface.md Auth:
// POST /auth/password/reset-request, /reset; the account-recovery consume for
// 06-onboarding-flows Flow D). Embedded Postgres, synthetic data only.
//
//   - reset-request now actually ISSUES a persisted token, while staying
//     uniform/no-oracle: byte-identical response for an existing vs a
//     non-existing identifier, AND a credential_token row IS created for the
//     existing one, NONE for the non-existing one.
//   - /reset consumes: the new password verifies (argon2id), the token is marked
//     consumed, and the account's prior sessions are revoked. A second consume,
//     an expired token, and an unknown token are all rejected opaquely (401).
//   - /account-recovery consumes a reissue-setup token (token-gated,
//     unauthenticated): sets email + password; a second consume is rejected.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { createSession, validateSession, verifyPassword, hashToken } from '@curiolab/runtime'
import { CredentialTokenService } from '@curiolab/app'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeMinor } from './helpers/fixtures.js'
import { requestPasswordReset, resetPassword, consumeAccountRecovery } from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

async function credentialTokenCount(): Promise<number> {
  const [row] = await h.sql`select count(*)::int as n from credential_token`
  return row!.n as number
}
async function tokenRowsFor(accountId: string): Promise<number> {
  const [row] = await h.sql`select count(*)::int as n from credential_token where account_id = ${accountId}`
  return row!.n as number
}

// ===========================================================================
describe('requestPasswordReset (POST /api/auth/password/reset-request) — issue + no oracle', () => {
  test('byte-identical response for an existing vs a non-existing identifier', async () => {
    const email = `req-${randomUUID().slice(0, 8)}@example.test`
    await makeAdult(h.sql, { email })
    const existing = await requestPasswordReset({ sql: h.sql, body: { identifier: email } })
    const missing = await requestPasswordReset({
      sql: h.sql,
      body: { identifier: `nobody-${randomUUID().slice(0, 8)}@example.test` },
    })
    expect(existing.status).toBe(missing.status)
    expect(JSON.stringify(existing.body)).toBe(JSON.stringify(missing.body))
    expect(JSON.stringify(existing.body)).not.toMatch(/exist|found|unknown|account|guardian|director/i)
  })

  test('a token row IS created for the existing identifier, NONE for the non-existing', async () => {
    const email = `rowcheck-${randomUUID().slice(0, 8)}@example.test`
    const acct = await makeAdult(h.sql, { email })

    await requestPasswordReset({ sql: h.sql, body: { identifier: email } })
    expect(await tokenRowsFor(acct)).toBe(1)

    const before = await credentialTokenCount()
    await requestPasswordReset({
      sql: h.sql,
      body: { identifier: `ghost-${randomUUID().slice(0, 8)}@example.test` },
    })
    // The non-existing identifier persists no token.
    expect(await credentialTokenCount()).toBe(before)
  })

  test('routes a self_private minor to the chapter_director (seam), still uniform 202', async () => {
    const minor = await makeMinor(h.sql, { credentialOwner: 'self_private', dateOfBirth: '2009-01-01' })
    const [u] = await h.sql`select username from account where id = ${minor}`
    const routes: string[] = []
    const res = await requestPasswordReset({
      sql: h.sql,
      body: { identifier: u!.username as string },
      deliver: (r) => {
        routes.push(r.route)
      },
    })
    expect(res.status).toBe(202)
    expect(routes).toEqual(['chapter_director'])
  })

  test('a missing identifier is a 400, not a 500', async () => {
    const res = await requestPasswordReset({ sql: h.sql, body: {} })
    expect(res.status).toBe(400)
  })
})

// ===========================================================================
describe('resetPassword (POST /api/auth/password/reset) — consume', () => {
  async function issueFor(email: string): Promise<string> {
    const r = await new CredentialTokenService({ sql: h.sql }).issuePasswordReset(email)
    return r!.token
  }

  test('consumes: the new password verifies, the token is consumed, prior sessions revoked', async () => {
    const email = `rc-${randomUUID().slice(0, 8)}@example.test`
    const acct = await makeAdult(h.sql, { email })
    const { token: sessionToken } = await createSession(h.sql, {
      accountId: acct,
      expiresAt: new Date(Date.now() + 3_600_000),
    })
    const token = await issueFor(email)
    const newPassword = 'ResetViaHttp!91'

    const res = await resetPassword({ sql: h.sql, body: { token, newPassword } })
    expect(res.status).toBe(200)

    const [a] = await h.sql`select password_hash from account where id = ${acct}`
    expect(await verifyPassword(a!.password_hash as string, newPassword)).toBe(true)
    const [t] = await h.sql`select consumed_at from credential_token where account_id = ${acct}`
    expect(t!.consumed_at).not.toBeNull()
    expect(await validateSession(h.sql, sessionToken)).toBeNull()
  })

  test('a second consume of the same token is a 401', async () => {
    const email = `rc2-${randomUUID().slice(0, 8)}@example.test`
    await makeAdult(h.sql, { email })
    const token = await issueFor(email)
    await resetPassword({ sql: h.sql, body: { token, newPassword: 'FirstHttp!11' } })
    const res = await resetPassword({ sql: h.sql, body: { token, newPassword: 'SecondHttp!22' } })
    expect(res.status).toBe(401)
  })

  test('an expired token is a 401', async () => {
    const email = `rcexp-${randomUUID().slice(0, 8)}@example.test`
    await makeAdult(h.sql, { email })
    const past = new Date('2020-01-01T00:00:00Z')
    const r = await new CredentialTokenService({ sql: h.sql, config: { passwordResetTtlMs: 1000 } })
      .issuePasswordReset(email, { now: past })
    const res = await resetPassword({ sql: h.sql, body: { token: r!.token, newPassword: 'ExpHttp!33' } })
    expect(res.status).toBe(401)
  })

  test('an unknown token is a 401', async () => {
    const res = await resetPassword({ sql: h.sql, body: { token: `forged-${randomUUID()}`, newPassword: 'X!44abc' } })
    expect(res.status).toBe(401)
  })

  test('a missing field is a 400', async () => {
    const res = await resetPassword({ sql: h.sql, body: { token: 'only-token' } })
    expect(res.status).toBe(400)
  })
})

// ===========================================================================
describe('consumeAccountRecovery (POST /api/auth/account-recovery) — token-gated', () => {
  /** Seed a username-only adult ex-student + a live account_recovery token; return the raw token. */
  async function seedRecovery(): Promise<{ accountId: string; token: string }> {
    const accountId = await makeMinor(h.sql, { dateOfBirth: '2004-01-01', maturationState: 'minor' })
    const raw = `recover-${randomUUID()}`
    await h.sql`
      insert into credential_token (account_id, token_hash, purpose, expires_at)
      values (${accountId}, ${hashToken(raw)}, 'account_recovery', now() + interval '14 days')
    `
    return { accountId, token: raw }
  }

  test('unauthenticated consume sets email + password and consumes the token', async () => {
    const { accountId, token } = await seedRecovery()
    const email = `recovered-${randomUUID().slice(0, 8)}@example.test`
    const newPassword = 'RecoverHttp!77'

    const res = await consumeAccountRecovery({ sql: h.sql, body: { token, email, newPassword } })
    expect(res.status).toBe(200)

    const [a] = await h.sql`select email, username, password_hash from account where id = ${accountId}`
    expect((a!.email as string).toLowerCase()).toBe(email.toLowerCase())
    expect(a!.username).toBeNull()
    expect(await verifyPassword(a!.password_hash as string, newPassword)).toBe(true)
    const [t] = await h.sql`select consumed_at from credential_token where account_id = ${accountId}`
    expect(t!.consumed_at).not.toBeNull()
  })

  test('a second consume of the same recovery token is a 401', async () => {
    const { token } = await seedRecovery()
    await consumeAccountRecovery({
      sql: h.sql,
      body: { token, email: `r1-${randomUUID().slice(0, 8)}@example.test`, newPassword: 'RecoverA!11' },
    })
    const res = await consumeAccountRecovery({
      sql: h.sql,
      body: { token, email: `r2-${randomUUID().slice(0, 8)}@example.test`, newPassword: 'RecoverB!22' },
    })
    expect(res.status).toBe(401)
  })

  test('a missing field is a 400', async () => {
    const res = await consumeAccountRecovery({ sql: h.sql, body: { token: 'only-token' } })
    expect(res.status).toBe(400)
  })
})
