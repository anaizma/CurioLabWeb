// GET  /api/guardian/children/:id/grants — the six grant types with status (guardian.view_grants).
// POST /api/guardian/children/:id/grants — capture a grant (consent.grant). Appends
// an append-only consent_grant row; not a mutation of any existing row.
import { cookies } from 'next/headers'
import { getSql, viewChildGrants, captureChildGrant, SESSION_COOKIE } from '@curiolab/http'

export async function GET(_req: Request, ctx: RouteContext<'/api/guardian/children/[id]/grants'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await viewChildGrants({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}

export async function POST(req: Request, ctx: RouteContext<'/api/guardian/children/[id]/grants'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await captureChildGrant({ sql: getSql(), sessionToken, params, body })
  return Response.json(out, { status })
}
