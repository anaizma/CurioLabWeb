// POST /api/ops/dm/threads/:threadId/read — the safety officer records a read-
// receipt to the thread's latest seq (Phase 3, design C.6; dm.oversee). Drives the
// 100%-coverage record in the monitoring ledger. Dark-gated behind MENTOR_DM_ENABLED.
import { cookies } from 'next/headers'
import { getSql, markDmThreadRead, SESSION_COOKIE } from '@curiolab/http'

export async function POST(_req: Request, ctx: RouteContext<'/api/ops/dm/threads/[threadId]/read'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await markDmThreadRead({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
