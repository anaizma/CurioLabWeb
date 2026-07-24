// POST /api/guardian/children/:id/grants/:type/revoke — per-grant revoke (consent.revoke).
// Not DELETE: it appends a revocation row (append-only). Revoking public_publication
// cascades (unpublishes the child's public items); an enrollment-required type is refused.
import { cookies } from 'next/headers'
import { getSql, revokeChildGrant, SESSION_COOKIE } from '@curiolab/http'

export async function POST(
  _req: Request,
  ctx: RouteContext<'/api/guardian/children/[id]/grants/[type]/revoke'>,
) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await revokeChildGrant({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
