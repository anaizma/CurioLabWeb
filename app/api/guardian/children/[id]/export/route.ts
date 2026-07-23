// POST /api/guardian/children/:id/export — file an export request (guardian.request_export).
import { cookies } from 'next/headers'
import { getSql, requestChildExport, SESSION_COOKIE } from '@curiolab/http'

export async function POST(_req: Request, ctx: RouteContext<'/api/guardian/children/[id]/export'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await requestChildExport({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
