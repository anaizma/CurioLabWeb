// POST /api/webhooks/resend — Resend bounce/complaint delivery-status updates.
// Actor-less, signature-verified over the RAW body, idempotent on the event id
// (05-api-surface.md "Webhooks"). Thin adapter: read the exact bytes with
// req.text() (a re-serialize would break the HMAC), read the signature header
// and the signing secret from the host secret store, call the controller.
import { getSql, resendWebhook } from '@curiolab/http'

export async function POST(req: Request) {
  const rawBody = await req.text()
  const signature =
    req.headers.get('resend-signature') ??
    req.headers.get('svix-signature') ??
    req.headers.get('webhook-signature')
  const secret = process.env.RESEND_WEBHOOK_SECRET ?? ''
  const { status, body } = await resendWebhook({ sql: getSql(), rawBody, signature, secret })
  return Response.json(body, { status })
}
