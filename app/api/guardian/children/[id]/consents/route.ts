// POST /api/guardian/children/:id/consents — a digital consent grant (consent.grant).
import { cookies } from 'next/headers'
import { getSql, grantChildConsent, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request, ctx: RouteContext<'/api/guardian/children/[id]/consents'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await grantChildConsent({ sql: getSql(), sessionToken, params, body })
  return Response.json(out, { status })
}
