// POST /api/ops/dm/flags/:flagId/review — the safety officer records a disposition
// for a raised content flag (Phase 3, design C.7; dm.oversee). A review is a new
// append-only record (dm_flag is append-only). Dark-gated behind MENTOR_DM_ENABLED.
import { cookies } from 'next/headers'
import { getSql, reviewDmFlag, SESSION_COOKIE, readJson } from '@curiolab/http'

export async function POST(req: Request, ctx: RouteContext<'/api/ops/dm/flags/[flagId]/review'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const body = await readJson(req)
  const { status, body: out } = await reviewDmFlag({ sql: getSql(), sessionToken, params, body })
  return Response.json(out, { status })
}
