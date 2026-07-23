// POST /api/public/newsletter/subscribe — the inert double-opt-in write
// (05-api-surface.md). Unauthenticated. Thin adapter: parse the body, call the
// controller with the shared db client, return the JSON Response. The confirm
// token is never in the response — it is emailed (the mailer seam).
import { getSql, subscribeNewsletter } from '@curiolab/http'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await subscribeNewsletter({ sql: getSql(), body })
  return Response.json(out, { status })
}
