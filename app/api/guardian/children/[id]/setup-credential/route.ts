// POST /api/guardian/children/:id/setup-credential — the verified guardian mints
// their child's one-time, guardian-routed setup credential (guardian.provision_child).
import { cookies } from 'next/headers'
import { getSql, provisionStudentSetup, clientIpFromRequest, SESSION_COOKIE } from '@curiolab/http'

export async function POST(
  req: Request,
  ctx: RouteContext<'/api/guardian/children/[id]/setup-credential'>,
) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body: out } = await provisionStudentSetup({
    sql: getSql(),
    sessionToken,
    params,
    clientIp: clientIpFromRequest(req),
  })
  return Response.json(out, { status })
}
