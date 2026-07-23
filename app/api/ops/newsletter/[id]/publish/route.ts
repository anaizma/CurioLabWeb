// POST /api/ops/newsletter/:id/publish — scheduled -> published (newsletter.publish, coupling E).
import { cookies } from 'next/headers'
import { getSql, publishNewsletter, SESSION_COOKIE } from '@curiolab/http'

export async function POST(_req: Request, ctx: RouteContext<'/api/ops/newsletter/[id]/publish'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await publishNewsletter({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
