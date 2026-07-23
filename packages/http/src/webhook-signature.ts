// -------------------------------------------------------------------------
// Webhook signature verification (05-api-surface.md "Webhooks": both webhooks
// "verify the provider signature over the raw request body"; the M3.6 brief:
// "HMAC; a configurable signing secret; reject unsigned/invalid with 4xx").
//
// The contract is a hex HMAC-SHA256 of the RAW request body under a shared
// signing secret, compared in constant time. The raw body — not a re-serialized
// parse — is what the HMAC covers, so the route adapters read `req.text()` and
// pass the exact bytes through (a re-`JSON.stringify` would reorder keys and
// break the digest). A `sha256=` prefix (some providers' convention) is
// tolerated. Real Resend (Svix) and Stripe use richer signed-payload schemes;
// this is the simplified configurable-HMAC contract the milestone specifies, and
// the one verification path both webhooks share.
// -------------------------------------------------------------------------

import { createHmac, timingSafeEqual } from 'node:crypto'

/** The hex HMAC-SHA256 of `rawBody` under `secret` — the signature contract. */
export function signWebhookBody(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
}

/**
 * Constant-time verify a provided signature against HMAC-SHA256(secret, rawBody).
 * Returns false for an absent/empty signature, an empty secret, or any mismatch
 * — the caller rejects those with a 4xx and mutates nothing. Never throws.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string,
): boolean {
  if (signature == null || signature.length === 0 || secret.length === 0) return false
  const expected = signWebhookBody(rawBody, secret)
  const provided = signature.startsWith('sha256=') ? signature.slice('sha256='.length) : signature
  const eb = Buffer.from(expected)
  const pb = Buffer.from(provided)
  // Length guard first: timingSafeEqual throws on a length mismatch, and an
  // unequal-length signature is trivially wrong.
  if (eb.length !== pb.length) return false
  return timingSafeEqual(eb, pb)
}
