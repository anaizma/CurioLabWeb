// POST /api/auth/account-recovery — token-gated, unauthenticated (like invite
// accept). Consumes an account_recovery setup token (minted by reissueSetup,
// 06-onboarding-flows Flow D) for a locked-out adult former student: sets email +
// a fresh password and marks the token consumed. An expired/consumed/unknown
// token is an opaque 401. The token DELIVERY is the deferred mailer seam.
import { getSql, consumeAccountRecovery } from '@curiolab/http'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await consumeAccountRecovery({ sql: getSql(), body })
  return Response.json(out, { status })
}
