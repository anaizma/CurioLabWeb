// -------------------------------------------------------------------------
// SubscriberService — Milestone 3.6: the newsletter subscriber list behind the
// unauthenticated write set (05-api-surface.md): POST /public/newsletter/
// subscribe (double opt-in), the confirm step, and
// GET /public/newsletter/unsubscribe/:token.
//
// The service is actor-less and INERT (like LeadService): it never calls
// `authorize`, it writes ONLY to the subscriber list, and it creates only a row
// that carries no authority. subscribe creates a PENDING subscriber (confirm
// token issued, confirmed_at null) and returns the raw confirm token (the mailer
// seam); confirm activates it (sets confirmed_at); unsubscribe sets
// unsubscribed_at, token-gated and idempotent. A second subscribe for a LIVE
// email is idempotent (the partial-unique index (email) WHERE unsubscribed_at IS
// NULL holds). Embedded Postgres, synthetic data only.
// -------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { hashToken } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { SubscriberService, InvalidSubscriberTokenError } from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

function service() {
  return new SubscriberService({ sql: h.sql })
}

async function countSubscribers(): Promise<number> {
  const [row] = await h.sql`select count(*)::int as n from newsletter_subscriber`
  return row!.n as number
}
async function countAccounts(): Promise<number> {
  const [row] = await h.sql`select count(*)::int as n from account`
  return row!.n as number
}

let n = 0
function freshEmail(): string {
  n += 1
  return `subscriber-${Date.now()}-${n}@example.test`
}

describe('subscribe — the inert double-opt-in write', () => {
  test('creates a PENDING subscriber (confirm token issued, confirmed_at null) and NO account', async () => {
    const accountsBefore = await countAccounts()
    const email = freshEmail()
    const result = await service().subscribe({ email, source: 'footer_form' })

    expect(result.alreadySubscribed).toBe(false)
    expect(typeof result.confirmToken).toBe('string')
    expect((result.confirmToken as string).length).toBeGreaterThan(0)

    const [row] = await h.sql`
      select email, source, confirmed_at, unsubscribed_at, delivery_status,
             confirm_token_hash, unsubscribe_token_hash
      from newsletter_subscriber where id = ${result.subscriberId}
    `
    expect(row!.email).toBe(email)
    expect(row!.source).toBe('footer_form')
    // Pending: not confirmed, not unsubscribed, active delivery.
    expect(row!.confirmed_at).toBeNull()
    expect(row!.unsubscribed_at).toBeNull()
    expect(row!.delivery_status).toBe('active')
    // Only the HASH of the confirm token is stored — never the raw token.
    expect(row!.confirm_token_hash).toBe(hashToken(result.confirmToken as string))
    expect(row!.confirm_token_hash).not.toBe(result.confirmToken)
    // An unsubscribe token is issued too (the link in every send).
    expect(row!.unsubscribe_token_hash).not.toBeNull()

    // Inert: no account created.
    expect(await countAccounts()).toBe(accountsBefore)
  })

  test('source is optional', async () => {
    const result = await service().subscribe({ email: freshEmail() })
    const [row] = await h.sql`select source from newsletter_subscriber where id = ${result.subscriberId}`
    expect(row!.source).toBeNull()
  })

  test('a second subscribe for a LIVE email is idempotent (no second row)', async () => {
    const email = freshEmail()
    const first = await service().subscribe({ email })
    const before = await countSubscribers()
    const second = await service().subscribe({ email })

    expect(second.alreadySubscribed).toBe(true)
    expect(second.subscriberId).toBe(first.subscriberId)
    // No new token is minted on the idempotent path.
    expect(second.confirmToken).toBeNull()
    expect(await countSubscribers()).toBe(before)
  })

  test('the idempotency is case-insensitive on email (citext)', async () => {
    const email = `Mixed-${Date.now()}@Example.Test`
    const first = await service().subscribe({ email })
    const second = await service().subscribe({ email: email.toLowerCase() })
    expect(second.alreadySubscribed).toBe(true)
    expect(second.subscriberId).toBe(first.subscriberId)
  })
})

describe('confirm — the double-opt-in activation', () => {
  test('confirm activates a pending subscriber (sets confirmed_at)', async () => {
    const { subscriberId, confirmToken } = await service().subscribe({ email: freshEmail() })
    const result = await service().confirm(confirmToken as string)

    expect(result.subscriberId).toBe(subscriberId)
    expect(result.confirmed).toBe(true)
    const [row] = await h.sql`select confirmed_at from newsletter_subscriber where id = ${subscriberId}`
    expect(row!.confirmed_at).not.toBeNull()
  })

  test('confirm is idempotent (a second confirm is a no-op success)', async () => {
    const { subscriberId, confirmToken } = await service().subscribe({ email: freshEmail() })
    const first = await service().confirm(confirmToken as string)
    const [afterFirst] = await h.sql`select confirmed_at from newsletter_subscriber where id = ${subscriberId}`
    const second = await service().confirm(confirmToken as string)
    const [afterSecond] = await h.sql`select confirmed_at from newsletter_subscriber where id = ${subscriberId}`

    expect(first.confirmed).toBe(true)
    expect(second.confirmed).toBe(true)
    // confirmed_at is stamped once and not moved by the replay.
    expect(new Date(afterSecond!.confirmed_at as string).getTime()).toBe(
      new Date(afterFirst!.confirmed_at as string).getTime(),
    )
  })

  test('an unknown confirm token is rejected (opaque)', async () => {
    await expect(service().confirm('not-a-real-token')).rejects.toBeInstanceOf(
      InvalidSubscriberTokenError,
    )
  })
})

describe('unsubscribe — token-gated, idempotent', () => {
  test('unsubscribe sets unsubscribed_at', async () => {
    const email = freshEmail()
    const sub = await service().subscribe({ email })
    // Read the raw unsubscribe token via the result seam.
    const unsubToken = sub.unsubscribeToken as string
    const result = await service().unsubscribe(unsubToken)

    expect(result.subscriberId).toBe(sub.subscriberId)
    expect(result.unsubscribed).toBe(true)
    const [row] = await h.sql`select unsubscribed_at from newsletter_subscriber where id = ${sub.subscriberId}`
    expect(row!.unsubscribed_at).not.toBeNull()
  })

  test('unsubscribe is idempotent (second call is a no-op success, timestamp unmoved)', async () => {
    const sub = await service().subscribe({ email: freshEmail() })
    const token = sub.unsubscribeToken as string
    await service().unsubscribe(token)
    const [afterFirst] = await h.sql`select unsubscribed_at from newsletter_subscriber where id = ${sub.subscriberId}`
    const second = await service().unsubscribe(token)
    const [afterSecond] = await h.sql`select unsubscribed_at from newsletter_subscriber where id = ${sub.subscriberId}`

    expect(second.unsubscribed).toBe(true)
    expect(new Date(afterSecond!.unsubscribed_at as string).getTime()).toBe(
      new Date(afterFirst!.unsubscribed_at as string).getTime(),
    )
  })

  test('after unsubscribe, a re-subscribe of the same email is a fresh LIVE row (index slot freed)', async () => {
    const email = freshEmail()
    const first = await service().subscribe({ email })
    await service().unsubscribe(first.unsubscribeToken as string)
    const second = await service().subscribe({ email })
    expect(second.alreadySubscribed).toBe(false)
    expect(second.subscriberId).not.toBe(first.subscriberId)
  })

  test('an unknown unsubscribe token is rejected (opaque)', async () => {
    await expect(service().unsubscribe('not-a-real-token')).rejects.toBeInstanceOf(
      InvalidSubscriberTokenError,
    )
  })
})
