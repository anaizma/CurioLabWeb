// GET /api/guardian/children/:id/fees — fee status + scholarships, never an amount.
import { cookies } from 'next/headers'
import { getSql, viewChildFees, SESSION_COOKIE } from '@curiolab/http'

export async function GET(_req: Request, ctx: RouteContext<'/api/guardian/children/[id]/fees'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await viewChildFees({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
