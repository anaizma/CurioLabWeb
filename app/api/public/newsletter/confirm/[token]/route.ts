// GET /api/public/newsletter/confirm/:token — the double-opt-in activation
// (05-api-surface.md double opt-in). Unauthenticated, token-gated. Thin adapter:
// pull the token from the route params, call the controller.
import { getSql, confirmNewsletter } from '@curiolab/http'

export async function GET(
  _req: Request,
  ctx: RouteContext<'/api/public/newsletter/confirm/[token]'>,
) {
  const { token } = await ctx.params
  const { status, body } = await confirmNewsletter({ sql: getSql(), params: { token } })
  return Response.json(body, { status })
}
