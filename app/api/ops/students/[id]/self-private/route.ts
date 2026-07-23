// POST /api/ops/students/:id/self-private — the 16+ credential privatization
// (guardian_provisioned -> self_private). Self session; requires a non-guardian
// chapter adult witness (body.witnessedBy). Afterwards password reset routes to
// the Chapter Director.
import { cookies } from 'next/headers'
import { getSql, selfPrivate, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request, ctx: RouteContext<'/api/ops/students/[id]/self-private'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await selfPrivate({ sql: getSql(), sessionToken, params, body })
  return Response.json(out, { status })
}
