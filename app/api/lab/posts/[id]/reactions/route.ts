// POST/DELETE /api/lab/posts/:id/reactions — react / unreact to a post (feed.react).
import { cookies } from 'next/headers'
import { getSql, addReaction, removeReaction, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request, ctx: RouteContext<'/api/lab/posts/[id]/reactions'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await addReaction({
    sql: getSql(),
    sessionToken,
    targetType: 'post',
    params,
    body,
  })
  return Response.json(out, { status })
}

export async function DELETE(req: Request, ctx: RouteContext<'/api/lab/posts/[id]/reactions'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await removeReaction({
    sql: getSql(),
    sessionToken,
    targetType: 'post',
    params,
    body,
  })
  return Response.json(out, { status })
}
