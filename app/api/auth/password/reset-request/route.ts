// POST /api/auth/password/reset-request — inert, uniform response, no
// account-existence oracle (05-api-surface.md). Token minting/persistence and
// delivery are deferred mailer seams; rate limiting is an edge concern.
import { getSql, requestPasswordReset } from '@curiolab/http'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await requestPasswordReset({ sql: getSql(), body })
  return Response.json(out, { status })
}
