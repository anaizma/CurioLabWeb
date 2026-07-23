// -------------------------------------------------------------------------
// Provider-webhook controllers — Milestone 3.6 (05-api-surface.md "Webhooks";
// 01-stack.md "Bounce and complaint handling via Resend webhooks").
//
// POST /webhooks/resend and POST /webhooks/stripe do NOT go through `authorize`
// (there is no actor). Both:
//   * verify the provider signature over the RAW request body (HMAC-SHA256 with a
//     configurable signing secret; an unsigned/invalid call is rejected 4xx and
//     mutates nothing),
//   * are idempotent on the provider event id via the webhook_event ledger (a
//     replayed event is a no-op 200),
//   * mutate ONLY the narrow delivery/payment status fields — never identity,
//     consent, or standing.
//
// These tests drive the controllers directly against the embedded-Postgres
// harness with synthetic payloads; the route adapters get their own smoke test.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { hashToken } from '@curiolab/runtime'
import {
  resendWebhook,
  stripeWebhook,
  signWebhookBody,
} from '../src/index.js'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeTerm, makeApplication, makeEnrollment } from './helpers/fixtures.js'

let h: Harness
const SECRET = 'whsec_test_shared_secret'

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

// --- fixtures --------------------------------------------------------------

async function makeSubscriber(email: string): Promise<string> {
  const [row] = await h.sql`
    insert into newsletter_subscriber (email, source, confirm_token_hash, unsubscribe_token_hash)
    values (${email}, 'footer', ${hashToken(randomUUID())}, ${hashToken(randomUUID())})
    returning id
  `
  return row!.id as string
}

async function makeInvite(targetEmail: string): Promise<string> {
  const issuedBy = await makeAdult(h.sql)
  // A mentor invite is email-targeted and binds no enrollment record (a guardian
  // invite would trip the enrollment-binding trigger), which is all the webhook's
  // by-email delivery-status match needs.
  const [row] = await h.sql`
    insert into invite (token_hash, kind, target_email, issued_by, expires_at, status, delivery_status)
    values (${hashToken(randomUUID())}, 'mentor', ${targetEmail}, ${issuedBy},
            now() + interval '14 days', 'issued', 'sent')
    returning id
  `
  return row!.id as string
}

async function makePaymentRef(customerRef: string): Promise<string> {
  const chapter = await makeChapter(h.sql)
  const term = await makeTerm(h.sql, chapter)
  const createdBy = await makeAdult(h.sql)
  const application = await makeApplication(
    h.sql,
    chapter,
    `parent-${randomUUID().slice(0, 8)}@example.test`,
  )
  const enrollment = await makeEnrollment(h.sql, {
    applicationId: application,
    chapterId: chapter,
    termId: term,
    createdBy,
  })
  const [row] = await h.sql`
    insert into payment_ref (enrollment_record_id, stripe_customer_ref, status, tier_paid_for)
    values (${enrollment}, ${customerRef}, 'active', 'explorer')
    returning id
  `
  return row!.id as string
}

function resendPayload(type: string, to: string, id = `evt_${randomUUID().slice(0, 12)}`) {
  return JSON.stringify({ id, type, data: { email_id: randomUUID(), to }, created_at: '2026-07-23T00:00:00Z' })
}

function stripePayload(type: string, customer: string, id = `evt_${randomUUID().slice(0, 12)}`) {
  return JSON.stringify({ id, type, data: { object: { customer } } })
}

async function deliveryStatusOfSubscriber(id: string): Promise<string> {
  const [row] = await h.sql`select delivery_status from newsletter_subscriber where id = ${id}`
  return row!.delivery_status as string
}
async function deliveryStatusOfInvite(id: string): Promise<string> {
  const [row] = await h.sql`select delivery_status from invite where id = ${id}`
  return row!.delivery_status as string
}
async function statusOfPaymentRef(id: string): Promise<string> {
  const [row] = await h.sql`select status from payment_ref where id = ${id}`
  return row!.status as string
}

// ---------------------------------------------------------------------------
describe('POST /webhooks/resend — signature, idempotency, delivery-status only', () => {
  test('a VALID signature on a bounce updates the matching subscriber AND invite delivery status', async () => {
    const email = `bounced-${randomUUID().slice(0, 8)}@example.test`
    const subscriberId = await makeSubscriber(email)
    const inviteId = await makeInvite(email)

    const rawBody = resendPayload('email.bounced', email)
    const res = await resendWebhook({
      sql: h.sql,
      rawBody,
      signature: signWebhookBody(rawBody, SECRET),
      secret: SECRET,
    })

    expect(res.status).toBe(200)
    expect(await deliveryStatusOfSubscriber(subscriberId)).toBe('bounced')
    expect(await deliveryStatusOfInvite(inviteId)).toBe('bounced')
  })

  test('a complaint sets delivery_status = complained', async () => {
    const email = `complained-${randomUUID().slice(0, 8)}@example.test`
    const subscriberId = await makeSubscriber(email)
    const rawBody = resendPayload('email.complained', email)
    const res = await resendWebhook({ sql: h.sql, rawBody, signature: signWebhookBody(rawBody, SECRET), secret: SECRET })
    expect(res.status).toBe(200)
    expect(await deliveryStatusOfSubscriber(subscriberId)).toBe('complained')
  })

  test('an INVALID signature is rejected 4xx and mutates nothing', async () => {
    const email = `nosig-${randomUUID().slice(0, 8)}@example.test`
    const subscriberId = await makeSubscriber(email)
    const rawBody = resendPayload('email.bounced', email)

    const res = await resendWebhook({ sql: h.sql, rawBody, signature: 'deadbeef', secret: SECRET })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
    // Untouched.
    expect(await deliveryStatusOfSubscriber(subscriberId)).toBe('active')
    // No ledger row written for a rejected call.
    const [row] = await h.sql`select count(*)::int as n from webhook_event where provider = 'resend'`
    // (there may be rows from other tests; assert this event id is absent)
    const eventId = (JSON.parse(rawBody) as { id: string }).id
    const [ev] = await h.sql`select 1 from webhook_event where provider = 'resend' and event_id = ${eventId}`
    expect(ev).toBeUndefined()
    expect(typeof row!.n).toBe('number')
  })

  test('an ABSENT signature is rejected 4xx', async () => {
    const email = `absent-${randomUUID().slice(0, 8)}@example.test`
    const rawBody = resendPayload('email.bounced', email)
    const res = await resendWebhook({ sql: h.sql, rawBody, signature: null, secret: SECRET })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })

  test('a REPLAYED event id is a no-op 200 (idempotent — does not re-mutate)', async () => {
    const email = `replay-${randomUUID().slice(0, 8)}@example.test`
    const subscriberId = await makeSubscriber(email)
    const rawBody = resendPayload('email.bounced', email)
    const sig = signWebhookBody(rawBody, SECRET)

    const first = await resendWebhook({ sql: h.sql, rawBody, signature: sig, secret: SECRET })
    expect(first.status).toBe(200)
    expect(await deliveryStatusOfSubscriber(subscriberId)).toBe('bounced')

    // Reset the field, then replay the SAME event: the ledger dedups it, so the
    // status is NOT re-mutated (proves the no-op, not just an idempotent value).
    await h.sql`update newsletter_subscriber set delivery_status = 'active' where id = ${subscriberId}`
    const replay = await resendWebhook({ sql: h.sql, rawBody, signature: sig, secret: SECRET })
    expect(replay.status).toBe(200)
    expect(await deliveryStatusOfSubscriber(subscriberId)).toBe('active')
  })

  test('mutates ONLY delivery status — identity/consent/standing tables untouched', async () => {
    const email = `narrow-${randomUUID().slice(0, 8)}@example.test`
    await makeSubscriber(email)
    const snap = async () => {
      const [a] = await h.sql`select count(*)::int as n from account`
      const [c] = await h.sql`select count(*)::int as n from consent`
      const [s] = await h.sql`select count(*)::int as n from session`
      const [m] = await h.sql`select count(*)::int as n from membership`
      const [g] = await h.sql`select count(*)::int as n from guardianship`
      return { a: a!.n, c: c!.n, s: s!.n, m: m!.n, g: g!.n }
    }
    const before = await snap()
    const rawBody = resendPayload('email.bounced', email)
    await resendWebhook({ sql: h.sql, rawBody, signature: signWebhookBody(rawBody, SECRET), secret: SECRET })
    expect(await snap()).toEqual(before)
  })
})

// ---------------------------------------------------------------------------
describe('POST /webhooks/stripe — signature, idempotency, payment-status only', () => {
  test('a VALID signature on a failed payment sets payment_ref.status = past_due', async () => {
    const customer = `cus_${randomUUID().slice(0, 10)}`
    const paymentRefId = await makePaymentRef(customer)
    const rawBody = stripePayload('invoice.payment_failed', customer)
    const res = await stripeWebhook({ sql: h.sql, rawBody, signature: signWebhookBody(rawBody, SECRET), secret: SECRET })
    expect(res.status).toBe(200)
    expect(await statusOfPaymentRef(paymentRefId)).toBe('past_due')
  })

  test('a succeeded payment sets payment_ref.status = active', async () => {
    const customer = `cus_${randomUUID().slice(0, 10)}`
    const paymentRefId = await makePaymentRef(customer)
    await h.sql`update payment_ref set status = 'past_due' where id = ${paymentRefId}`
    const rawBody = stripePayload('invoice.payment_succeeded', customer)
    const res = await stripeWebhook({ sql: h.sql, rawBody, signature: signWebhookBody(rawBody, SECRET), secret: SECRET })
    expect(res.status).toBe(200)
    expect(await statusOfPaymentRef(paymentRefId)).toBe('active')
  })

  test('an INVALID signature is rejected 4xx and mutates nothing', async () => {
    const customer = `cus_${randomUUID().slice(0, 10)}`
    const paymentRefId = await makePaymentRef(customer)
    const rawBody = stripePayload('invoice.payment_failed', customer)
    const res = await stripeWebhook({ sql: h.sql, rawBody, signature: 'deadbeef', secret: SECRET })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
    expect(await statusOfPaymentRef(paymentRefId)).toBe('active')
  })

  test('a REPLAYED event id is a no-op 200 (idempotent)', async () => {
    const customer = `cus_${randomUUID().slice(0, 10)}`
    const paymentRefId = await makePaymentRef(customer)
    const rawBody = stripePayload('invoice.payment_failed', customer)
    const sig = signWebhookBody(rawBody, SECRET)

    await stripeWebhook({ sql: h.sql, rawBody, signature: sig, secret: SECRET })
    expect(await statusOfPaymentRef(paymentRefId)).toBe('past_due')

    await h.sql`update payment_ref set status = 'active' where id = ${paymentRefId}`
    const replay = await stripeWebhook({ sql: h.sql, rawBody, signature: sig, secret: SECRET })
    expect(replay.status).toBe(200)
    expect(await statusOfPaymentRef(paymentRefId)).toBe('active')
  })

  test('mutates ONLY payment status — no card data, no amounts, identity untouched', async () => {
    const customer = `cus_${randomUUID().slice(0, 10)}`
    await makePaymentRef(customer)
    const snap = async () => {
      const [a] = await h.sql`select count(*)::int as n from account`
      const [c] = await h.sql`select count(*)::int as n from consent`
      const [e] = await h.sql`select count(*)::int as n from enrollment_record`
      return { a: a!.n, c: c!.n, e: e!.n }
    }
    const before = await snap()
    const rawBody = stripePayload('invoice.payment_failed', customer)
    await stripeWebhook({ sql: h.sql, rawBody, signature: signWebhookBody(rawBody, SECRET), secret: SECRET })
    expect(await snap()).toEqual(before)
  })
})
