// POST /api/lab/moderation/:id/ack — acknowledge a report (feed.moderate).
import { cookies } from 'next/headers'
import { getSql, transitionReport, SESSION_COOKIE } from '@curiolab/http'

export async function POST(_req: Request, ctx: RouteContext<'/api/lab/moderation/[id]/ack'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body: out } = await transitionReport({
    sql: getSql(),
    sessionToken,
    action: 'ack',
    params,
    body: {},
  })
  return Response.json(out, { status })
}
