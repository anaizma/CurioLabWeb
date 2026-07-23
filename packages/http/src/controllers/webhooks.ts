// -------------------------------------------------------------------------
// Provider-webhook controllers — Milestone 3.6 (05-api-surface.md "Webhooks";
// 01-stack.md "Bounce and complaint handling via Resend webhooks").
//
//   resendWebhook  POST /webhooks/resend  — on bounce/complaint, set the matching
//                                            invite AND newsletter_subscriber
//                                            delivery_status. Delivery status only.
//   stripeWebhook  POST /webhooks/stripe  — set the matching payment_ref.status.
//                                            Payment status only; no amounts, no
//                                            card data.
//
// Neither goes through `authorize` — there is NO actor (05-api-surface.md: "do
// not go through `authorize` because there is no actor"). Each carries its own
// documented protection instead, in this fixed order:
//   1. Verify the provider signature over the RAW body (HMAC-SHA256, configurable
//      secret). An unsigned/invalid call is rejected 4xx BEFORE any DB work and
//      mutates nothing — no ledger row, no status change.
//   2. Parse the body; a malformed payload (no event id) is a 4xx, mutates nothing.
//   3. In ONE transaction: INSERT the (provider, event_id) into the webhook_event
//      ledger ON CONFLICT DO NOTHING. A replay inserts nothing -> a no-op 200 that
//      does NOT re-apply the mutation. A first-seen event inserts, then applies
//      the narrow status mutation in the same transaction.
//
// "A forged call that somehow passed signature check still could not touch
// identity, consent, or standing" (05-api-surface.md): the only writes here are
// to invite.delivery_status / newsletter_subscriber.delivery_status /
// payment_ref.status. Actor-less and inert, so — like LeadService — no
// `assertAuthorized` backstop is invoked (nothing calls `authorize`).
// -------------------------------------------------------------------------

import type { Sql, TransactionSql } from 'postgres'
import { runPublic } from '../run.js'
import { verifyWebhookSignature } from '../webhook-signature.js'
import type { ControllerResult } from '../types.js'

/** The by-value input a webhook controller takes; the route adapter fills it. */
export interface WebhookInput {
  sql: Sql
  /** The exact bytes of the request body the signature was computed over. */
  rawBody: string
  /** The provider signature header value (null when absent). */
  signature: string | null
  /** The configurable signing secret (from the host secret store in production). */
  secret: string
}

export interface WebhookResult {
  received: true
  /** True when the event id was already in the ledger — a replayed no-op. */
  deduplicated: boolean
  /** The action applied (or 'none' for an event type this webhook ignores). */
  action: string
  /** How many rows the narrow status mutation touched. */
  matched: number
}

const BAD_SIGNATURE: ControllerResult<{ error: string }> = {
  status: 400,
  body: { error: 'invalid_signature' },
}
const BAD_PAYLOAD: ControllerResult<{ error: string }> = {
  status: 400,
  body: { error: 'invalid_payload' },
}

interface ParsedEvent {
  id: string
  type: string
  data: Record<string, unknown>
}

/** Parse the raw body into `{ id, type, data }`, or null when it is unusable. */
function parseEvent(rawBody: string): ParsedEvent | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const obj = parsed as Record<string, unknown>
  const id = obj.id
  const type = obj.type
  if (typeof id !== 'string' || id.length === 0 || typeof type !== 'string') return null
  const data =
    obj.data !== null && typeof obj.data === 'object' && !Array.isArray(obj.data)
      ? (obj.data as Record<string, unknown>)
      : {}
  return { id, type, data }
}

/**
 * The shared verify + dedup shell. Verifies the signature, parses the event, then
 * runs `apply` inside one transaction ONLY when the (provider, event_id) is
 * first-seen; a replay is a no-op 200. `apply` returns `{ action, matched }`.
 */
interface ApplyOutcome {
  action: string
  matched: number
  deduplicated: boolean
}

async function handleWebhook(
  provider: string,
  input: WebhookInput,
  apply: (tx: TransactionSql, event: ParsedEvent) => Promise<{ action: string; matched: number }>,
): Promise<ControllerResult<WebhookResult | { error: string }>> {
  return runPublic<WebhookResult | { error: string }>(async () => {
    if (!verifyWebhookSignature(input.rawBody, input.signature, input.secret)) {
      return BAD_SIGNATURE
    }
    const event = parseEvent(input.rawBody)
    if (event === null) return BAD_PAYLOAD

    const outcome = (await input.sql.begin(async (tx) => {
      const claimed = await tx`
        insert into webhook_event (provider, event_id)
        values (${provider}, ${event.id})
        on conflict (provider, event_id) do nothing
        returning event_id
      `
      if (claimed.length === 0) {
        // Replayed event: the ledger already has it -> a no-op.
        return { action: 'none', matched: 0, deduplicated: true }
      }
      const applied = await apply(tx, event)
      return { ...applied, deduplicated: false }
    })) as ApplyOutcome

    return {
      status: 200,
      body: {
        received: true,
        deduplicated: outcome.deduplicated,
        action: outcome.action,
        matched: outcome.matched,
      },
    } as ControllerResult<WebhookResult>
  })
}

/** The recipient email of a Resend event: `data.to` (string or array) or `data.email`. */
function recipientOf(data: Record<string, unknown>): string | null {
  const to = data.to
  if (typeof to === 'string' && to.length > 0) return to
  if (Array.isArray(to) && typeof to[0] === 'string') return to[0]
  const email = data.email
  if (typeof email === 'string' && email.length > 0) return email
  return null
}

/** Resend event type -> the subscriber/invite delivery_status it sets, if any. */
function resendDeliveryStatus(type: string): 'bounced' | 'complained' | null {
  if (type === 'email.bounced') return 'bounced'
  if (type === 'email.complained') return 'complained'
  return null
}

/**
 * POST /webhooks/resend. On a bounce/complaint, set the matching invite AND
 * newsletter_subscriber delivery_status by recipient email (both tables are fed
 * by Resend — 02-data-model.md invite.delivery_status "fed by Resend webhook",
 * and newsletter_subscriber.delivery_status). Any other event type is recorded
 * for idempotency and ignored (action 'none'). Mutates ONLY delivery status.
 */
export function resendWebhook(
  input: WebhookInput,
): Promise<ControllerResult<WebhookResult | { error: string }>> {
  return handleWebhook('resend', input, async (tx, event) => {
    const status = resendDeliveryStatus(event.type)
    if (status === null) return { action: 'none', matched: 0 }
    const recipient = recipientOf(event.data)
    if (recipient === null) return { action: status, matched: 0 }

    const subs = await tx`
      update newsletter_subscriber set delivery_status = ${status}
      where email = ${recipient}
      returning id
    `
    const invites = await tx`
      update invite set delivery_status = ${status}
      where target_email = ${recipient}
      returning id
    `
    return { action: status, matched: subs.length + invites.length }
  })
}

/** Stripe event type -> the payment_ref.status it sets, if any. */
function stripePaymentStatus(type: string): 'active' | 'past_due' | null {
  switch (type) {
    case 'invoice.paid':
    case 'invoice.payment_succeeded':
      return 'active'
    case 'invoice.payment_failed':
      return 'past_due'
    default:
      return null
  }
}

/** The Stripe customer ref carried on the event's `data.object.customer`. */
function stripeCustomerOf(data: Record<string, unknown>): string | null {
  const object = data.object
  if (object === null || typeof object !== 'object' || Array.isArray(object)) return null
  const customer = (object as Record<string, unknown>).customer
  return typeof customer === 'string' && customer.length > 0 ? customer : null
}

/**
 * POST /webhooks/stripe. Set the matching payment_ref.status (keyed on
 * stripe_customer_ref) from the event type. Money is never a source of truth
 * here (02-data-model.md): NO amounts, NO card data — only the coarse status.
 * Any other event type is recorded for idempotency and ignored.
 */
export function stripeWebhook(
  input: WebhookInput,
): Promise<ControllerResult<WebhookResult | { error: string }>> {
  return handleWebhook('stripe', input, async (tx, event) => {
    const status = stripePaymentStatus(event.type)
    if (status === null) return { action: 'none', matched: 0 }
    const customer = stripeCustomerOf(event.data)
    if (customer === null) return { action: status, matched: 0 }

    const refs = await tx`
      update payment_ref set status = ${status}
      where stripe_customer_ref = ${customer}
      returning id
    `
    return { action: status, matched: refs.length }
  })
}
