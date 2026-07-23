// POST /api/ops/guardianships/:id/revoke — 04-state-machines guardianship
// `verified -> revoked` (guardianship.revoke, chapter_director / admin).
import { cookies } from 'next/headers'
import { getSql, revokeGuardianship, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request, ctx: RouteContext<'/api/ops/guardianships/[id]/revoke'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await revokeGuardianship({ sql: getSql(), sessionToken, params, body })
  return Response.json(out, { status })
}
