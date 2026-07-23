// POST /api/ops/newsletter/:id/submit — draft -> in_review (newsletter.submit_review).
import { cookies } from 'next/headers'
import { getSql, submitNewsletter, SESSION_COOKIE } from '@curiolab/http'

export async function POST(_req: Request, ctx: RouteContext<'/api/ops/newsletter/[id]/submit'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await submitNewsletter({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
