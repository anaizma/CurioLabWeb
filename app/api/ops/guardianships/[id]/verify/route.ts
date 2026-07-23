// POST /api/ops/guardianships/:id/verify — the name-match authority floor.
import { cookies } from 'next/headers'
import { getSql, verifyGuardianship, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request, ctx: RouteContext<'/api/ops/guardianships/[id]/verify'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await verifyGuardianship({ sql: getSql(), sessionToken, params, body })
  return Response.json(out, { status })
}
