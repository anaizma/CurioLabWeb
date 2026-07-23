// POST /api/ops/media/:id/remove — terminal removed (media.review).
import { cookies } from 'next/headers'
import { getSql, removeMedia, SESSION_COOKIE } from '@curiolab/http'

export async function POST(_req: Request, ctx: RouteContext<'/api/ops/media/[id]/remove'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await removeMedia({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
