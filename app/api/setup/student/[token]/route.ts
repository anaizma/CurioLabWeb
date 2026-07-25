// POST /api/setup/student/:token — the child redeems the one-time minor_setup
// credential (with the guardian present) to set the account password.
// Unauthenticated, token-gated, inert: sets only the password; the account stays
// pending (no membership until the director activates it).
import { getSql, redeemStudentSetup } from '@curiolab/http'

export async function POST(req: Request, ctx: RouteContext<'/api/setup/student/[token]'>) {
  const { token } = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await redeemStudentSetup({ sql: getSql(), params: { token }, body })
  return Response.json(out, { status })
}
