// POST /api/ops/accounts/:id/reissue-setup — Flow D step 4 (account.recover).
// After a documented identity check the Chapter Director mints a fresh setup
// token for a locked-out adult former student; rejected against an active
// membership. The token delivery is a deferred mailer seam.
import { cookies } from 'next/headers'
import { getSql, reissueSetup, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request, ctx: RouteContext<'/api/ops/accounts/[id]/reissue-setup'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await reissueSetup({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
