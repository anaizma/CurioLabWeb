// POST /api/ops/newsletter/:id/schedule — in_review -> scheduled (newsletter.schedule).
import { cookies } from 'next/headers'
import { getSql, scheduleNewsletter, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request, ctx: RouteContext<'/api/ops/newsletter/[id]/schedule'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await scheduleNewsletter({ sql: getSql(), sessionToken, params, body })
  return Response.json(out, { status })
}
