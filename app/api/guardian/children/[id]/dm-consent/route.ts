// POST /api/guardian/children/:id/dm-consent — a guardian captures the mentor_dm
// SIGNED-FORM consent for their child (consent.grant). Mentor-student DM Phase 1,
// built DARK behind MENTOR_DM_ENABLED. Method is fixed to signed_form; the service
// + DB trigger refuse a click / missing artifact. Reuses ConsentGrantService.
import { cookies } from 'next/headers'
import { getSql, captureMentorDmConsent, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request, ctx: RouteContext<'/api/guardian/children/[id]/dm-consent'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await captureMentorDmConsent({ sql: getSql(), sessionToken, params, body })
  return Response.json(out, { status })
}
