// POST /api/ops/newsletter/:id/unpublish — published -> archived (newsletter.unpublish).
import { cookies } from 'next/headers'
import { getSql, unpublishNewsletter, SESSION_COOKIE } from '@curiolab/http'

export async function POST(_req: Request, ctx: RouteContext<'/api/ops/newsletter/[id]/unpublish'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await unpublishNewsletter({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
