// POST /api/invites/:token/accept-student — the username (guardian-mediated)
// accept path. Unauthenticated, single-use, inert: creates a pending student
// account with a username identity, no email, no active membership.
import { getSql, acceptStudent } from '@curiolab/http'

export async function POST(req: Request, ctx: RouteContext<'/api/invites/[token]/accept-student'>) {
  const { token } = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await acceptStudent({ sql: getSql(), params: { token }, body })
  return Response.json(out, { status })
}
