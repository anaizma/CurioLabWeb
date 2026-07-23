// POST /api/ops/export-requests/:id/fulfill — assemble the review-right bundle.
import { cookies } from 'next/headers'
import { getSql, fulfillExport, SESSION_COOKIE } from '@curiolab/http'

export async function POST(_req: Request, ctx: RouteContext<'/api/ops/export-requests/[id]/fulfill'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await fulfillExport({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
