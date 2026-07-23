// GET /api/invites/:token — timing-safe invite validate. Unauthenticated,
// actor-less; returns {usable, kind, chapter} only, never a name, and an
// identical response for invalid/expired/accepted (05-api-surface.md).
import { getSql, validateInviteToken } from '@curiolab/http'

export async function GET(_req: Request, ctx: RouteContext<'/api/invites/[token]'>) {
  const { token } = await ctx.params
  const { status, body } = await validateInviteToken({ sql: getSql(), params: { token } })
  return Response.json(body, { status })
}
