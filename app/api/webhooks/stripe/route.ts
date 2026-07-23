// POST /api/webhooks/stripe — Stripe payment-status updates. Actor-less,
// signature-verified over the RAW body, idempotent on the event id
// (05-api-surface.md "Webhooks"). Mutates only payment_ref.status — no amounts,
// no card data. Thin adapter: read the exact bytes with req.text(), read the
// Stripe-Signature header and the signing secret from the host secret store.
import { getSql, stripeWebhook } from '@curiolab/http'

export async function POST(req: Request) {
  const rawBody = await req.text()
  const signature = req.headers.get('stripe-signature')
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? ''
  const { status, body } = await stripeWebhook({ sql: getSql(), rawBody, signature, secret })
  return Response.json(body, { status })
}
