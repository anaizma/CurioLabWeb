// POST /api/ops/media/:id/clear — clear for photo_media-gated public use (media.review).
import { cookies } from 'next/headers'
import { getSql, clearMedia, SESSION_COOKIE } from '@curiolab/http'

export async function POST(_req: Request, ctx: RouteContext<'/api/ops/media/[id]/clear'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await clearMedia({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
