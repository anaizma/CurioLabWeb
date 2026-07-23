// GET /api/public/newsletter/unsubscribe/:token — flip one subscriber row
// (05-api-surface.md; outside the account graph). Unauthenticated, token-gated.
// Thin adapter: pull the token from the route params, call the controller.
import { getSql, unsubscribeNewsletter } from '@curiolab/http'

export async function GET(
  _req: Request,
  ctx: RouteContext<'/api/public/newsletter/unsubscribe/[token]'>,
) {
  const { token } = await ctx.params
  const { status, body } = await unsubscribeNewsletter({ sql: getSql(), params: { token } })
  return Response.json(body, { status })
}
