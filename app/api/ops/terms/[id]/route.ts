// PATCH /api/ops/terms/:id — rename / re-date a term (term.manage, chapter_director).
import { cookies } from 'next/headers'
import { getSql, updateTerm, SESSION_COOKIE } from '@curiolab/http'

export async function PATCH(req: Request, ctx: RouteContext<'/api/ops/terms/[id]'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await updateTerm({ sql: getSql(), sessionToken, params, body })
  return Response.json(out, { status })
}
