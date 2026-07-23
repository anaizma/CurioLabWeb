// POST /api/ops/deletion-requests/:id/review — requested -> under_review (deletion.review).
import { cookies } from 'next/headers'
import { getSql, reviewDeletion, SESSION_COOKIE } from '@curiolab/http'

export async function POST(_req: Request, ctx: RouteContext<'/api/ops/deletion-requests/[id]/review'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await reviewDeletion({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
