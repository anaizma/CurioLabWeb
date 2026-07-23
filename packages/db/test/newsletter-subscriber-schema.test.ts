// -------------------------------------------------------------------------
// Milestone 3.6 — newsletter_subscriber + webhook_event schema guarantees.
//
// The additive migration 0017_newsletter_subscriber.sql adds the subscriber
// list (outside the account graph) and the webhook_event idempotency ledger.
// These tests are the red-before-green witnesses for its guarantees:
//   * newsletter_subscriber.delivery_status defaults 'active'; invalid enum
//     values are rejected; email is NOT NULL; there is NO fk to account;
//   * the partial unique index (email) WHERE unsubscribed_at IS NULL — one LIVE
//     subscriber per email, but an unsubscribed row frees the slot for a
//     re-subscribe;
//   * webhook_event PK (provider, event_id) dedups a replayed provider event —
//     a second insert of the same (provider, event_id) is rejected, while the
//     same event_id under a DIFFERENT provider is allowed;
//   * the Mechanism-A grants (app DML; analytics default-deny — the subscriber
//     list holds contactable emails, so the analytics read role must not reach
//     it directly, matching the M3.5 tables).
//
// TDD: run with CURIOLAB_MIGRATE_UPTO=0016 to witness these fail (the relations
// do not exist yet); the default run applies 0017 and they pass. Reuses the
// shared embedded-Postgres harness exactly like newsletter-schema.test.ts.
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

async function makeSubscriber(
  overrides: { email?: string; unsubscribedAt?: string | null } = {},
): Promise<string> {
  const email = overrides.email ?? `subscriber-${randomUUID().slice(0, 8)}@example.test`
  const [row] = await h.sql`
    insert into newsletter_subscriber (email, source, unsubscribed_at)
    values (${email}, 'footer_form', ${overrides.unsubscribedAt ?? null})
    returning id
  `
  return row!.id as string
}

// ---------------------------------------------------------------------------
describe('newsletter_subscriber enum, defaults, and shape', () => {
  test('a valid subscriber inserts and defaults delivery_status=active', async () => {
    const [row] = await h.sql`
      insert into newsletter_subscriber (email, source)
      values (${`fresh-${randomUUID().slice(0, 8)}@example.test`}, 'footer_form')
      returning delivery_status, subscribed_at, confirmed_at, unsubscribed_at
    `
    expect(row!.delivery_status).toBe('active')
    expect(row!.subscribed_at).not.toBeNull()
    // Double opt-in: a fresh subscriber is pending (unconfirmed) and live.
    expect(row!.confirmed_at).toBeNull()
    expect(row!.unsubscribed_at).toBeNull()
  })

  test('email is NOT NULL', async () => {
    await expect(h.sql`
      insert into newsletter_subscriber (email, source) values (${null}, 'x')
    `).rejects.toThrow(/null value|not-null/i)
  })

  test('an invalid delivery_status is rejected', async () => {
    await expect(h.sql`
      insert into newsletter_subscriber (email, delivery_status)
      values (${`bad-${randomUUID().slice(0, 8)}@example.test`}, 'bogus')
    `).rejects.toThrow(/invalid input value for enum|newsletter_subscriber_delivery_status/i)
  })

  test('email is citext (case-insensitive) for the live-uniqueness match', async () => {
    const email = `Case-${randomUUID().slice(0, 8)}@Example.Test`
    await makeSubscriber({ email })
    // A different-cased same address collides on the partial unique index.
    await expect(makeSubscriber({ email: email.toLowerCase() })).rejects.toThrow(
      /duplicate key|unique/i,
    )
  })
})

// ---------------------------------------------------------------------------
describe('the partial unique index (email) WHERE unsubscribed_at IS NULL', () => {
  test('a second LIVE subscriber for the same email is rejected', async () => {
    const email = `live-${randomUUID().slice(0, 8)}@example.test`
    await makeSubscriber({ email })
    await expect(makeSubscriber({ email })).rejects.toThrow(/duplicate key|unique/i)
  })

  test('an unsubscribed row frees the slot: a re-subscribe of the same email is allowed', async () => {
    const email = `resub-${randomUUID().slice(0, 8)}@example.test`
    const first = await makeSubscriber({ email })
    // Unsubscribe the first, then a fresh live row for the same email is fine.
    await h.sql`update newsletter_subscriber set unsubscribed_at = now() where id = ${first}`
    const second = await makeSubscriber({ email })
    expect(second).not.toBe(first)
    // Two unsubscribed rows for the same email are also fine (index is partial).
    await h.sql`update newsletter_subscriber set unsubscribed_at = now() where id = ${second}`
    const third = await makeSubscriber({ email })
    expect(third).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
describe('webhook_event idempotency ledger (PK provider, event_id)', () => {
  test('a replayed (provider, event_id) is rejected by the primary key', async () => {
    const eventId = `evt_${randomUUID().slice(0, 12)}`
    await h.sql`insert into webhook_event (provider, event_id) values ('stripe', ${eventId})`
    await expect(h.sql`
      insert into webhook_event (provider, event_id) values ('stripe', ${eventId})
    `).rejects.toThrow(/duplicate key|unique|primary key/i)
  })

  test('the same event_id under a different provider is allowed', async () => {
    const eventId = `evt_${randomUUID().slice(0, 12)}`
    await h.sql`insert into webhook_event (provider, event_id) values ('stripe', ${eventId})`
    const rows = await h.sql`
      insert into webhook_event (provider, event_id) values ('resend', ${eventId}) returning provider
    `
    expect(rows.length).toBe(1)
  })

  test('on conflict do nothing makes a replay a no-op (the idempotency primitive)', async () => {
    const eventId = `evt_${randomUUID().slice(0, 12)}`
    const first = await h.sql`
      insert into webhook_event (provider, event_id) values ('resend', ${eventId})
      on conflict (provider, event_id) do nothing returning event_id
    `
    const second = await h.sql`
      insert into webhook_event (provider, event_id) values ('resend', ${eventId})
      on conflict (provider, event_id) do nothing returning event_id
    `
    expect(first.length).toBe(1) // first insert happened
    expect(second.length).toBe(0) // replay inserted nothing
  })
})

// ---------------------------------------------------------------------------
describe('Mechanism A: grants on the M3.6 tables', () => {
  test('the analytics role is denied SELECT on newsletter_subscriber (default-deny)', async () => {
    await makeSubscriber()
    const analytics = h.connectAs('curiolab_analytics', 'analytics_pw')
    await expect(analytics`select 1 from newsletter_subscriber limit 1`).rejects.toThrow(
      /permission denied/i,
    )
  })

  test('the analytics role is denied SELECT on webhook_event (default-deny)', async () => {
    const analytics = h.connectAs('curiolab_analytics', 'analytics_pw')
    await expect(analytics`select 1 from webhook_event limit 1`).rejects.toThrow(
      /permission denied/i,
    )
  })

  test('the app role may DML newsletter_subscriber and webhook_event (control)', async () => {
    const app = h.connectAs('curiolab_app', 'app_pw')
    const subs = await app`
      insert into newsletter_subscriber (email, source)
      values (${`app-${randomUUID().slice(0, 8)}@example.test`}, 'ctl')
      returning id
    `
    expect(subs.length).toBe(1)
    const evts = await app`
      insert into webhook_event (provider, event_id) values ('stripe', ${`e_${randomUUID().slice(0, 8)}`})
      returning event_id
    `
    expect(evts.length).toBe(1)
  })
})
