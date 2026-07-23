// POST /api/guardian/children/:id/consents/:type/revoke — a digital consent revoke
// (consent.revoke). Not DELETE: it inserts an append-only revoke row.
import { cookies } from 'next/headers'
import { getSql, revokeChildConsent, SESSION_COOKIE } from '@curiolab/http'

export async function POST(
  _req: Request,
  ctx: RouteContext<'/api/guardian/children/[id]/consents/[type]/revoke'>,
) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await revokeChildConsent({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
