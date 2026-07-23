// GET /api/public/newsletter/:slug — one published issue with its items, else 404
// (public, no session). The `:slug` is the newsletter_issue id (no slug column).
import { getSql, viewPublicNewsletter } from '@curiolab/http'

export async function GET(_req: Request, ctx: RouteContext<'/api/public/newsletter/[slug]'>) {
  const { slug } = await ctx.params
  const { status, body } = await viewPublicNewsletter({ sql: getSql(), params: { slug } })
  return Response.json(body, { status })
}
