// POST /api/ops/deletion-requests/:id/fulfill — apply the tiered review outcome.
import { cookies } from 'next/headers'
import { getSql, fulfillDeletion, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request, ctx: RouteContext<'/api/ops/deletion-requests/[id]/fulfill'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await fulfillDeletion({ sql: getSql(), sessionToken, params, body })
  return Response.json(out, { status })
}
