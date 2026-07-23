// POST /api/lab/moderation/:id/resolve — resolve a report (moderation.resolve, age >= 18).
import { cookies } from 'next/headers'
import { getSql, transitionReport, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request, ctx: RouteContext<'/api/lab/moderation/[id]/resolve'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await transitionReport({
    sql: getSql(),
    sessionToken,
    action: 'resolve',
    params,
    body,
  })
  return Response.json(out, { status })
}
