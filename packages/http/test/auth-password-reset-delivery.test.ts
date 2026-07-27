// -------------------------------------------------------------------------
// The password-reset DELIVERY seam and the reset-token pre-flight.
//
// The security property under test is the one the whole flow exists to preserve:
// POST /auth/password/reset-request must be byte-identical whether or not the
// identifier resolves, and wiring an actual mailer into it must not change that
// — including when the mailer throws.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult } from './helpers/fixtures.js'
import {
  checkPasswordResetToken,
  requestPasswordReset,
  resetPassword,
  type PasswordResetDelivery,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

describe('the delivery seam', () => {
  test('carries the RAW token and the expiry, so a link can actually be built', async () => {
    const email = `reset-${randomUUID().slice(0, 8)}@example.test`
    await makeAdult(h.sql, { email })

    const delivered: PasswordResetDelivery[] = []
    const now = new Date()
    const res = await requestPasswordReset({
      sql: h.sql,
      body: { identifier: email },
      now,
      deliver: (d) => {
        delivered.push(d)
      },
    })

    expect(res.status).toBe(202)
    expect(delivered).toHaveLength(1)
    expect(delivered[0]!.route).toBe('self_email')
    expect(delivered[0]!.token).toBeTruthy()
    // One hour (PASSWORD_RESET_TTL_MS), so the message can say so honestly.
    expect(delivered[0]!.expiresAt.getTime() - now.getTime()).toBe(60 * 60 * 1000)
  })

  test('the raw token is NOT what is stored — only its hash is', async () => {
    const email = `reset-${randomUUID().slice(0, 8)}@example.test`
    const accountId = await makeAdult(h.sql, { email })
    const delivered: PasswordResetDelivery[] = []
    await requestPasswordReset({
      sql: h.sql,
      body: { identifier: email },
      deliver: (d) => {
        delivered.push(d)
      },
    })
    const [row] = await h.sql`
      select token_hash from credential_token
      where account_id = ${accountId} and purpose = 'password_reset' and consumed_at is null
    `
    expect(row!.token_hash).not.toBe(delivered[0]!.token)
  })

  test('an UNKNOWN identifier never fires the seam, and the response is identical', async () => {
    const delivered: PasswordResetDelivery[] = []
    const res = await requestPasswordReset({
      sql: h.sql,
      body: { identifier: `nobody-${randomUUID().slice(0, 8)}@example.test` },
      deliver: (d) => {
        delivered.push(d)
      },
    })
    expect(delivered).toEqual([])
    expect(res.status).toBe(202)
    expect(res.body).toEqual({ requested: true })
  })

  test('a THROWING mailer still returns the same 202 (no send-failure oracle)', async () => {
    // If a failed send changed the response, the endpoint would leak that the
    // address exists — the send only ever runs for an identifier that resolved.
    const email = `reset-${randomUUID().slice(0, 8)}@example.test`
    await makeAdult(h.sql, { email })
    const res = await requestPasswordReset({
      sql: h.sql,
      body: { identifier: email },
      deliver: () => {
        throw new Error('resend is down')
      },
    })
    expect(res.status).toBe(202)
    expect(res.body).toEqual({ requested: true })
  })
})

describe('the reset-token pre-flight', () => {
  test('a freshly issued token is usable', async () => {
    const email = `reset-${randomUUID().slice(0, 8)}@example.test`
    await makeAdult(h.sql, { email })
    const delivered: PasswordResetDelivery[] = []
    await requestPasswordReset({
      sql: h.sql,
      body: { identifier: email },
      deliver: (d) => {
        delivered.push(d)
      },
    })
    const res = await checkPasswordResetToken({ sql: h.sql, body: { token: delivered[0]!.token } })
    expect(res.body).toEqual({ usable: true })
  })

  test('checking does NOT consume it', async () => {
    const email = `reset-${randomUUID().slice(0, 8)}@example.test`
    await makeAdult(h.sql, { email })
    const delivered: PasswordResetDelivery[] = []
    await requestPasswordReset({
      sql: h.sql,
      body: { identifier: email },
      deliver: (d) => {
        delivered.push(d)
      },
    })
    await checkPasswordResetToken({ sql: h.sql, body: { token: delivered[0]!.token } })
    const res = await resetPassword({
      sql: h.sql,
      body: { token: delivered[0]!.token, newPassword: 'a-quiet-Tuesday-in-March' },
    })
    expect(res.status).toBe(200)
  })

  test('a consumed, expired or unknown token is one answer', async () => {
    const email = `reset-${randomUUID().slice(0, 8)}@example.test`
    await makeAdult(h.sql, { email })
    const delivered: PasswordResetDelivery[] = []
    await requestPasswordReset({
      sql: h.sql,
      body: { identifier: email },
      deliver: (d) => {
        delivered.push(d)
      },
    })
    await resetPassword({
      sql: h.sql,
      body: { token: delivered[0]!.token, newPassword: 'a-quiet-Tuesday-in-March' },
    })
    const consumed = await checkPasswordResetToken({ sql: h.sql, body: { token: delivered[0]!.token } })
    const unknown = await checkPasswordResetToken({ sql: h.sql, body: { token: `forged-${randomUUID()}` } })
    expect(consumed.body).toEqual({ usable: false })
    expect(unknown.body).toEqual(consumed.body)
  })
})

describe('the password-changed notification seam', () => {
  test('fires once on a successful reset, with the account it belongs to', async () => {
    const email = `reset-${randomUUID().slice(0, 8)}@example.test`
    const accountId = await makeAdult(h.sql, { email })
    const delivered: PasswordResetDelivery[] = []
    await requestPasswordReset({
      sql: h.sql,
      body: { identifier: email },
      deliver: (d) => {
        delivered.push(d)
      },
    })

    const changed: { accountId: string; at: Date }[] = []
    const res = await resetPassword({
      sql: h.sql,
      body: { token: delivered[0]!.token, newPassword: 'a-quiet-Tuesday-in-March' },
      notifyChanged: (n) => {
        changed.push(n)
      },
    })
    expect(res.status).toBe(200)
    expect(changed).toHaveLength(1)
    expect(changed[0]!.accountId).toBe(accountId)
  })

  test('does NOT fire when the reset is refused', async () => {
    const changed: unknown[] = []
    const res = await resetPassword({
      sql: h.sql,
      body: { token: `forged-${randomUUID()}`, newPassword: 'a-quiet-Tuesday-in-March' },
      notifyChanged: (n) => {
        changed.push(n)
      },
    })
    expect(res.status).toBe(401)
    expect(changed).toEqual([])
  })

  test('a THROWING notifier does not turn a completed reset into a failure', async () => {
    const email = `reset-${randomUUID().slice(0, 8)}@example.test`
    await makeAdult(h.sql, { email })
    const delivered: PasswordResetDelivery[] = []
    await requestPasswordReset({
      sql: h.sql,
      body: { identifier: email },
      deliver: (d) => {
        delivered.push(d)
      },
    })
    const res = await resetPassword({
      sql: h.sql,
      body: { token: delivered[0]!.token, newPassword: 'a-quiet-Tuesday-in-March' },
      notifyChanged: () => {
        throw new Error('resend is down')
      },
    })
    // The password IS already changed and the old sessions ARE already revoked;
    // reporting failure here would be a lie.
    expect(res.status).toBe(200)
  })
})

describe('the password policy is enforced at the HTTP surface', () => {
  async function freshToken(): Promise<string> {
    const email = `reset-${randomUUID().slice(0, 8)}@example.test`
    await makeAdult(h.sql, { email })
    const delivered: PasswordResetDelivery[] = []
    await requestPasswordReset({
      sql: h.sql,
      body: { identifier: email },
      deliver: (d) => {
        delivered.push(d)
      },
    })
    return delivered[0]!.token
  }

  test('a weak password is a 400 that NAMES the unmet rules', async () => {
    const res = await resetPassword({ sql: h.sql, body: { token: await freshToken(), newPassword: 'short1' } })
    expect(res.status).toBe(400)
    const body = res.body as unknown as { error: string; problems: string[] }
    expect(body.error).toBe('weak_password')
    expect(body.problems.length).toBeGreaterThan(0)
  })

  test('a refused password does NOT burn the token', async () => {
    // Otherwise one weak attempt would cost a fresh email round trip.
    const token = await freshToken()
    await resetPassword({ sql: h.sql, body: { token, newPassword: 'short1' } })
    const res = await resetPassword({ sql: h.sql, body: { token, newPassword: 'a-quiet-Tuesday-in-March' } })
    expect(res.status).toBe(200)
  })

  test('an INVALID token still wins over a weak password (no policy oracle)', async () => {
    // The order matters: a forged token must not be told its password was weak,
    // which would confirm the token was otherwise fine.
    const res = await resetPassword({
      sql: h.sql,
      body: { token: `forged-${randomUUID()}`, newPassword: 'short1' },
    })
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'invalid_token' })
  })
})
