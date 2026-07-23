// POST /api/ops/students/:id/consents/safeguard-suspend — the one sanctioned
// STAFF write to consent (consent.revoke_safeguarding, chapter_director / admin):
// `reason = safeguarding` revokes for public_profile + photo_media, firing C1.
import { cookies } from 'next/headers'
import { getSql, safeguardSuspend, SESSION_COOKIE } from '@curiolab/http'

export async function POST(
  _req: Request,
  ctx: RouteContext<'/api/ops/students/[id]/consents/safeguard-suspend'>,
) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await safeguardSuspend({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
