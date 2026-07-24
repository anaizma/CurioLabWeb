// GET /api/guardian/children/:id/public-items — the child's public-surface items
// only (public_listed projects + published narratives), never drafts or private
// messages (guardian.view_public_items).
import { cookies } from 'next/headers'
import { getSql, viewChildPublicItems, SESSION_COOKIE } from '@curiolab/http'

export async function GET(
  _req: Request,
  ctx: RouteContext<'/api/guardian/children/[id]/public-items'>,
) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await viewChildPublicItems({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
