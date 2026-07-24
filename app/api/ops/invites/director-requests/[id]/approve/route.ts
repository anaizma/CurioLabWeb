// POST /api/ops/invites/director-requests/:id/approve — a second, distinct
// director approves a pending request, minting the director invite
// (member.invite_director). Returns { requestId, inviteId, token, expiresAt }.
import { cookies } from 'next/headers'
import { getSql, approveDirectorInvite, SESSION_COOKIE } from '@curiolab/http'

export async function POST(
  _req: Request,
  ctx: RouteContext<'/api/ops/invites/director-requests/[id]/approve'>,
) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await approveDirectorInvite({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
