// POST /api/invites/:token/accept — the email (guardian/mentor/staff) accept
// path. Unauthenticated, single-use, inert: creates a pending account (and a
// pending guardianship edge for a guardian invite), zero authority.
import { getSql, acceptInvite } from '@curiolab/http'

export async function POST(req: Request, ctx: RouteContext<'/api/invites/[token]/accept'>) {
  const { token } = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await acceptInvite({ sql: getSql(), params: { token }, body })
  return Response.json(out, { status })
}
