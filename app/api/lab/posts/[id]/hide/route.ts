// POST /api/lab/posts/:id/hide — hide a post (feed.moderate, or feed.hide_safety
// with { safety: true }).
import { cookies } from 'next/headers'
import { getSql, hidePost, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request, ctx: RouteContext<'/api/lab/posts/[id]/hide'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await hidePost({ sql: getSql(), sessionToken, params, body })
  return Response.json(out, { status })
}
