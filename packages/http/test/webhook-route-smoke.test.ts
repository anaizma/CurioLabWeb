// -------------------------------------------------------------------------
// Webhook route-adapter smoke tests (Milestone 3.6). Prove the Next 16
// route.ts adapters for /api/webhooks/{resend,stripe} read the RAW body, extract
// the signature header, wire to their controller through the shared db seam and
// the env signing secret, and return a real Web Response. The embedded-Postgres
// `sql` is injected via setSqlForTesting so the adapter runs without a
// DATABASE_URL; the signing secret is set on the environment the adapter reads.
//
// A representative subscribe adapter (the non-dynamic public POST) is smoke-
// tested too. The [token] confirm/unsubscribe adapters use the Next `RouteContext`
// global and are validated by the root `next typegen` + `tsc` pass, not imported
// here (that would pull the Next-only global into this package's typecheck).
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import { hashToken } from '@curiolab/runtime'
import { setSqlForTesting, signWebhookBody } from '../src/index.js'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult } from './helpers/fixtures.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
  setSqlForTesting(h.sql)
}, 240_000)

afterAll(async () => {
  setSqlForTesting(null)
  await h?.end()
})

afterEach(() => {
  delete process.env.RESEND_WEBHOOK_SECRET
  delete process.env.STRIPE_WEBHOOK_SECRET
})

test('POST /api/webhooks/resend adapter verifies the signed body and updates delivery status', async () => {
  const secret = 'whsec_resend_route'
  process.env.RESEND_WEBHOOK_SECRET = secret
  const email = `route-bounce-${randomUUID().slice(0, 8)}@example.test`
  const [sub] = await h.sql`
    insert into newsletter_subscriber (email, source, confirm_token_hash, unsubscribe_token_hash)
    values (${email}, 'footer', ${hashToken(randomUUID())}, ${hashToken(randomUUID())})
    returning id
  `
  const subscriberId = sub!.id as string

  const rawBody = JSON.stringify({
    id: `evt_${randomUUID().slice(0, 12)}`,
    type: 'email.bounced',
    data: { to: email },
  })
  const { POST } = await import('../../../app/api/webhooks/resend/route.js')
  const req = new Request('http://localhost/api/webhooks/resend', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'resend-signature': signWebhookBody(rawBody, secret) },
    body: rawBody,
  })
  const res = await POST(req)

  expect(res).toBeInstanceOf(Response)
  expect(res.status).toBe(200)
  const [row] = await h.sql`select delivery_status from newsletter_subscriber where id = ${subscriberId}`
  expect(row!.delivery_status).toBe('bounced')
})

test('POST /api/webhooks/resend adapter rejects an unsigned request 4xx', async () => {
  process.env.RESEND_WEBHOOK_SECRET = 'whsec_resend_route'
  const rawBody = JSON.stringify({ id: `evt_${randomUUID().slice(0, 12)}`, type: 'email.bounced', data: { to: 'x@example.test' } })
  const { POST } = await import('../../../app/api/webhooks/resend/route.js')
  const req = new Request('http://localhost/api/webhooks/resend', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: rawBody,
  })
  const res = await POST(req)
  expect(res.status).toBeGreaterThanOrEqual(400)
  expect(res.status).toBeLessThan(500)
})

test('POST /api/webhooks/stripe adapter verifies the signed body and updates payment status', async () => {
  const secret = 'whsec_stripe_route'
  process.env.STRIPE_WEBHOOK_SECRET = secret
  const customer = `cus_${randomUUID().slice(0, 10)}`

  // A minimal enrollment chain for the payment_ref fk.
  const chapter = (await h.sql`insert into chapter (name, slug, tier, status, timezone)
    values ('Ch', ${'ch-' + randomUUID()}, 'active', 'active', 'America/New_York') returning id`)[0]!.id as string
  const term = (await h.sql`insert into term (chapter_id, name, starts_on, ends_on)
    values (${chapter}, 'T', '2099-09-01', '2099-12-15') returning id`)[0]!.id as string
  const createdBy = await makeAdult(h.sql)
  const application = (await h.sql`insert into application (kind, chapter_id, status, applicant_name, applicant_contact_email, guardian_name, guardian_email)
    values ('student', ${chapter}, 'submitted', 'Minor Testchild', ${`p-${randomUUID().slice(0, 8)}@example.test`}, 'Parent Testperson', ${`p-${randomUUID().slice(0, 8)}@example.test`}) returning id`)[0]!.id as string
  const enrollment = (await h.sql`insert into enrollment_record (application_id, chapter_id, term_id, signed_form_ref, guardian_name_on_form, date_of_birth, created_by)
    values (${application}, ${chapter}, ${term}, ${randomUUID()}, 'Parent Testperson', '2015-06-01', ${createdBy}) returning id`)[0]!.id as string
  const [pr] = await h.sql`insert into payment_ref (enrollment_record_id, stripe_customer_ref, status, tier_paid_for)
    values (${enrollment}, ${customer}, 'active', 'explorer') returning id`
  const paymentRefId = pr!.id as string

  const rawBody = JSON.stringify({
    id: `evt_${randomUUID().slice(0, 12)}`,
    type: 'invoice.payment_failed',
    data: { object: { customer } },
  })
  const { POST } = await import('../../../app/api/webhooks/stripe/route.js')
  const req = new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signWebhookBody(rawBody, secret) },
    body: rawBody,
  })
  const res = await POST(req)

  expect(res.status).toBe(200)
  const [row] = await h.sql`select status from payment_ref where id = ${paymentRefId}`
  expect(row!.status).toBe('past_due')
})

test('POST /api/public/newsletter/subscribe adapter returns 202 and creates a pending subscriber', async () => {
  const email = `route-sub-${randomUUID().slice(0, 8)}@example.test`
  const { POST } = await import('../../../app/api/public/newsletter/subscribe/route.js')
  const req = new Request('http://localhost/api/public/newsletter/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, source: 'footer' }),
  })
  const res = await POST(req)
  expect(res.status).toBe(202)
  const body = (await res.json()) as { subscriberId: string; alreadySubscribed: boolean }
  expect(body.subscriberId).toBeTruthy()
  expect(body.alreadySubscribed).toBe(false)
  const [row] = await h.sql`select confirmed_at from newsletter_subscriber where id = ${body.subscriberId}`
  expect(row!.confirmed_at).toBeNull()
})
