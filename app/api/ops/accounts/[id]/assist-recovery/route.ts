// POST /api/ops/accounts/:id/assist-recovery — the LOGGED mentor/director-assisted
// minor recovery (admin/director backend §9; account.assist_recovery). A mentor or
// instructor present with the minor mints a fresh guardian-routed setup token; the
// use is written to the access ledger (who assisted, which minor, when, IP) and the
// audit trail. Distinct from account.recover (the adult former-student reissue).
import { cookies } from 'next/headers'
import { getSql, assistRecovery, clientIpFromRequest, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request, ctx: RouteContext<'/api/ops/accounts/[id]/assist-recovery'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await assistRecovery({
    sql: getSql(),
    sessionToken,
    params,
    clientIp: clientIpFromRequest(req),
  })
  return Response.json(body, { status })
}
