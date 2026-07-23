// POST /api/lab/moderation/:id/escalate — escalate a report by hand (feed.moderate).
import { cookies } from 'next/headers'
import { getSql, transitionReport, SESSION_COOKIE } from '@curiolab/http'

export async function POST(_req: Request, ctx: RouteContext<'/api/lab/moderation/[id]/escalate'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body: out } = await transitionReport({
    sql: getSql(),
    sessionToken,
    action: 'escalate',
    params,
    body: {},
  })
  return Response.json(out, { status })
}
