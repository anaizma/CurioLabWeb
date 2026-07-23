// GET /api/guardian/children/:id/record — the composed child record (logs a read).
import { cookies } from 'next/headers'
import { getSql, viewChildRecord, SESSION_COOKIE } from '@curiolab/http'

export async function GET(_req: Request, ctx: RouteContext<'/api/guardian/children/[id]/record'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await viewChildRecord({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
