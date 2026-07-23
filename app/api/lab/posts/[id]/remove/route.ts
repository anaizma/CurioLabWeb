// POST /api/lab/posts/:id/remove — remove a post (feed.moderate; blanks the body).
import { cookies } from 'next/headers'
import { getSql, removePost, SESSION_COOKIE } from '@curiolab/http'

export async function POST(_req: Request, ctx: RouteContext<'/api/lab/posts/[id]/remove'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body: out } = await removePost({ sql: getSql(), sessionToken, params })
  return Response.json(out, { status })
}
