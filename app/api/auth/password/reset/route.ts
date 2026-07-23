// POST /api/auth/password/reset — token-gated, unauthenticated (05-api-surface.md
// the actor-less set). Consumes the reset token: sets the account's argon2id
// password, marks the token consumed, and revokes the account's prior sessions.
// An expired/consumed/unknown token is an opaque 401. Rate limiting is an edge
// concern; the token DELIVERY is the deferred mailer seam.
import { getSql, resetPassword } from '@curiolab/http'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await resetPassword({ sql: getSql(), body })
  return Response.json(out, { status })
}
