// POST /api/profile/narrative/:id/review — clear a minor's narrative to published (narrative.review).
import { cookies } from 'next/headers'
import { getSql, reviewNarrative, SESSION_COOKIE } from '@curiolab/http'

export async function POST(_req: Request, ctx: RouteContext<'/api/profile/narrative/[id]/review'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await reviewNarrative({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
