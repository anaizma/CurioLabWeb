// PATCH /api/lab/posts/:id — edit own post body (feed.post, own).
import { cookies } from 'next/headers'
import { getSql, editPost, SESSION_COOKIE } from '@curiolab/http'

export async function PATCH(req: Request, ctx: RouteContext<'/api/lab/posts/[id]'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await editPost({ sql: getSql(), sessionToken, params, body })
  return Response.json(out, { status })
}
