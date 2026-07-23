// -------------------------------------------------------------------------
// Public newsletter subscribe/confirm/unsubscribe controllers — Milestone 3.6
// (05-api-surface.md: POST /public/newsletter/subscribe (double opt-in),
// GET /public/newsletter/unsubscribe/:token, plus the confirm step the double
// opt-in requires). Unauthenticated, actor-less, inert — thin wrappers over
// SubscriberService that never surface the raw confirm token to the client (it
// is the mailer's seam, delivered by email).
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { hashToken } from '@curiolab/runtime'
import { subscribeNewsletter, confirmNewsletter, unsubscribeNewsletter } from '../src/index.js'
import { startHarness, type Harness } from './helpers/pg.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

let n = 0
function freshEmail(): string {
  n += 1
  return `sub-${Date.now()}-${n}@example.test`
}

/** Read the stored confirm/unsubscribe hashes so a test can forge the raw token. */
async function tokensFor(subscriberId: string): Promise<{ confirmHash: string; unsubHash: string }> {
  const [row] = await h.sql`
    select confirm_token_hash, unsubscribe_token_hash from newsletter_subscriber where id = ${subscriberId}
  `
  return { confirmHash: row!.confirm_token_hash as string, unsubHash: row!.unsubscribe_token_hash as string }
}

describe('POST /public/newsletter/subscribe', () => {
  test('subscribes and returns 202 WITHOUT leaking the confirm token', async () => {
    const email = freshEmail()
    const res = await subscribeNewsletter({ sql: h.sql, body: { email, source: 'footer' } })
    expect(res.status).toBe(202)
    const body = res.body as unknown as Record<string, unknown>
    expect(body.subscriberId).toBeTruthy()
    expect(body.alreadySubscribed).toBe(false)
    // The raw confirm/unsubscribe tokens are NEVER in the HTTP response.
    expect(JSON.stringify(body)).not.toMatch(/token/i)

    const [row] = await h.sql`select email, confirmed_at from newsletter_subscriber where id = ${body.subscriberId as string}`
    expect(row!.email).toBe(email)
    expect(row!.confirmed_at).toBeNull()
  })

  test('a missing email is a 400', async () => {
    const res = await subscribeNewsletter({ sql: h.sql, body: {} })
    expect(res.status).toBe(400)
  })

  test('a duplicate live subscribe is idempotent (202, alreadySubscribed)', async () => {
    const email = freshEmail()
    await subscribeNewsletter({ sql: h.sql, body: { email } })
    const res = await subscribeNewsletter({ sql: h.sql, body: { email } })
    expect(res.status).toBe(202)
    expect((res.body as unknown as Record<string, unknown>).alreadySubscribed).toBe(true)
  })
})

describe('GET /public/newsletter/confirm/:token', () => {
  test('confirms a pending subscriber', async () => {
    const email = freshEmail()
    const sub = await subscribeNewsletter({ sql: h.sql, body: { email } })
    const subscriberId = (sub.body as unknown as Record<string, unknown>).subscriberId as string
    // The HTTP controller never surfaces the raw confirm token (it is emailed),
    // so this test plants a known token's hash on the row and drives the
    // controller with that raw token (synthetic, test-only).
    const raw = randomUUID()
    await h.sql`update newsletter_subscriber set confirm_token_hash = ${hashToken(raw)} where id = ${subscriberId}`

    const res = await confirmNewsletter({ sql: h.sql, params: { token: raw } })
    expect(res.status).toBe(200)
    expect((res.body as unknown as Record<string, unknown>).confirmed).toBe(true)
    const [row] = await h.sql`select confirmed_at from newsletter_subscriber where id = ${subscriberId}`
    expect(row!.confirmed_at).not.toBeNull()
  })

  test('an unknown confirm token is a 401 (opaque token failure)', async () => {
    const res = await confirmNewsletter({ sql: h.sql, params: { token: 'nope' } })
    expect(res.status).toBe(401)
  })
})

describe('GET /public/newsletter/unsubscribe/:token', () => {
  test('unsubscribes the matching subscriber', async () => {
    const email = freshEmail()
    const sub = await subscribeNewsletter({ sql: h.sql, body: { email } })
    const subscriberId = (sub.body as unknown as Record<string, unknown>).subscriberId as string
    const raw = randomUUID()
    await h.sql`update newsletter_subscriber set unsubscribe_token_hash = ${hashToken(raw)} where id = ${subscriberId}`

    const res = await unsubscribeNewsletter({ sql: h.sql, params: { token: raw } })
    expect(res.status).toBe(200)
    expect((res.body as unknown as Record<string, unknown>).unsubscribed).toBe(true)
    const [row] = await h.sql`select unsubscribed_at from newsletter_subscriber where id = ${subscriberId}`
    expect(row!.unsubscribed_at).not.toBeNull()
  })

  test('an unknown unsubscribe token is a 401 (opaque)', async () => {
    const res = await unsubscribeNewsletter({ sql: h.sql, params: { token: 'nope' } })
    expect(res.status).toBe(401)
  })

  // Keep the unused helper referenced so lint stays clean if a future test needs it.
  test('token hashes are readable for forging (harness sanity)', async () => {
    const sub = await subscribeNewsletter({ sql: h.sql, body: { email: freshEmail() } })
    const { confirmHash, unsubHash } = await tokensFor((sub.body as unknown as Record<string, unknown>).subscriberId as string)
    expect(confirmHash).toBeTruthy()
    expect(unsubHash).toBeTruthy()
  })
})
