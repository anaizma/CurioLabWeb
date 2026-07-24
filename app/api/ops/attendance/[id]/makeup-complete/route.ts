// POST /api/ops/attendance/:id/makeup-complete — a mentor/director marks the
//      30-minute make-up check-in done (attendance.resolve). Append-only: a new
//      revision with makeup_status -> completed; idempotent on an already-completed
//      exception. :id is the stable exception_id.
import { cookies } from 'next/headers'
import { getSql, completeMakeup, SESSION_COOKIE } from '@curiolab/http'

export async function POST(
  _req: Request,
  ctx: RouteContext<'/api/ops/attendance/[id]/makeup-complete'>,
) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body: out } = await completeMakeup({ sql: getSql(), sessionToken, params })
  return Response.json(out, { status })
}
