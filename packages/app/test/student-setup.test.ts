// -------------------------------------------------------------------------
// StudentSetupService — focused coverage of the token-gated redemption's opaque
// failure surface and single-use/regenerate semantics (the happy chain + the
// guardian-mint gate are exercised end-to-end in account-origination.test.ts).
// Embedded Postgres.
// -------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { authorize, generateSessionToken, hashToken, verifyPassword } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeMinor } from './helpers/fixtures.js'
import { StudentSetupService, InvalidCredentialTokenError } from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

const svc = () => new StudentSetupService({ sql: h.sql, authorize })

// A pending, password-less minor shell + a live minor_setup token bound to it.
async function pendingShellWithToken(opts: { ttlMs?: number } = {}) {
  const student = await makeMinor(h.sql, { status: 'pending' })
  await h.sql`update account set password_hash = ${null} where id = ${student}`
  const token = generateSessionToken()
  const ttlMs = opts.ttlMs ?? 7 * 24 * 60 * 60 * 1000
  await h.sql`
    insert into credential_token (account_id, token_hash, purpose, expires_at)
    values (${student}, ${hashToken(token)}, 'minor_setup', now() + ${ttlMs} * interval '1 millisecond')
  `
  return { student, token }
}

describe('redeemSetupCredential', () => {
  test('sets the password, keeps the account pending, and is single-use', async () => {
    const { student, token } = await pendingShellWithToken()
    const res = await svc().redeemSetupCredential(token, 'hunter2 correct staple')
    expect(res.accountId).toBe(student)
    const [acct] = await h.sql`select password_hash, status from account where id = ${student}`
    expect(await verifyPassword(acct!.password_hash as string, 'hunter2 correct staple')).toBe(true)
    expect(acct!.status).toBe('pending') // no membership activation here
    // Single-use: a second redemption of the same token is refused.
    await expect(svc().redeemSetupCredential(token, 'another')).rejects.toBeInstanceOf(
      InvalidCredentialTokenError,
    )
  })

  test('an unknown token is one opaque InvalidCredentialTokenError', async () => {
    await expect(svc().redeemSetupCredential(generateSessionToken(), 'x')).rejects.toBeInstanceOf(
      InvalidCredentialTokenError,
    )
  })

  test('an expired token is refused (evaluated at decision time)', async () => {
    const { token } = await pendingShellWithToken({ ttlMs: -1000 }) // already expired
    await expect(svc().redeemSetupCredential(token, 'x')).rejects.toBeInstanceOf(
      InvalidCredentialTokenError,
    )
  })

  test('a password_reset token is NOT redeemable as a student setup token', async () => {
    const student = await makeMinor(h.sql, { status: 'pending' })
    const token = generateSessionToken()
    await h.sql`
      insert into credential_token (account_id, token_hash, purpose, expires_at)
      values (${student}, ${hashToken(token)}, 'password_reset', now() + interval '1 hour')
    `
    await expect(svc().redeemSetupCredential(token, 'x')).rejects.toBeInstanceOf(
      InvalidCredentialTokenError,
    )
  })
})
