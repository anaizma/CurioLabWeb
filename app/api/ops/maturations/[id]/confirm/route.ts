// POST /api/ops/maturations/:id/confirm — Flow D step 3 (maturation.confirm).
// The Chapter Director confirms coming-of-age: account maturation_pending ->
// self_managed and the verified guardianship edge lapses, atomically.
import { cookies } from 'next/headers'
import { getSql, confirmMaturation, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request, ctx: RouteContext<'/api/ops/maturations/[id]/confirm'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await confirmMaturation({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
