// POST /api/guardian/children/:id/deletion — file a deletion request (guardian.request_deletion).
import { cookies } from 'next/headers'
import { getSql, requestChildDeletion, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request, ctx: RouteContext<'/api/guardian/children/[id]/deletion'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await requestChildDeletion({ sql: getSql(), sessionToken, params, body })
  return Response.json(out, { status })
}
