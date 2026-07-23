// POST /api/ops/invites/:id/resend — supersede + reissue (member.invite).
import { cookies } from 'next/headers'
import { getSql, resendInvite, SESSION_COOKIE } from '@curiolab/http'

export async function POST(_req: Request, ctx: RouteContext<'/api/ops/invites/[id]/resend'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await resendInvite({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
