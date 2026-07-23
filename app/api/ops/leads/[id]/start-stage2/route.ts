// POST /api/ops/leads/:id/start-stage2 — staff-gated Stage 2 start (lead.invite).
import { cookies } from 'next/headers'
import { getSql, startStage2, SESSION_COOKIE } from '@curiolab/http'

export async function POST(_req: Request, ctx: RouteContext<'/api/ops/leads/[id]/start-stage2'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const { id } = await ctx.params
  const { status, body } = await startStage2({ sql: getSql(), sessionToken, params: { leadId: id } })
  return Response.json(body, { status })
}
