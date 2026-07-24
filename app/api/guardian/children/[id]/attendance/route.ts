// POST /api/guardian/children/:id/attendance — submit an absent/late attendance
//      exception for the guardian's own verified child (attendance.submit).
// GET  /api/guardian/children/:id/attendance — the child's exceptions + counts
//      (attendance.view_child; guardian-scoped).
import { cookies } from 'next/headers'
import { getSql, submitAttendance, viewChildAttendance, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request, ctx: RouteContext<'/api/guardian/children/[id]/attendance'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await submitAttendance({ sql: getSql(), sessionToken, params, body })
  return Response.json(out, { status })
}

export async function GET(_req: Request, ctx: RouteContext<'/api/guardian/children/[id]/attendance'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await viewChildAttendance({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
