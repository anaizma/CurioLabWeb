// POST /api/lab/posts/:id/comments — comment on a post (feed.comment).
import { cookies } from 'next/headers'
import { getSql, createComment, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request, ctx: RouteContext<'/api/lab/posts/[id]/comments'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await createComment({ sql: getSql(), sessionToken, params, body })
  return Response.json(out, { status })
}
