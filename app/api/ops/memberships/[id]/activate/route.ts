// POST /api/ops/memberships/:id/activate — couplings A + F (member.activate).
import { cookies } from 'next/headers'
import { getSql, activateMembership, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request, ctx: RouteContext<'/api/ops/memberships/[id]/activate'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await activateMembership({ sql: getSql(), sessionToken, params, body })
  return Response.json(out, { status })
}
