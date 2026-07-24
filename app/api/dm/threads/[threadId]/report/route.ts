// POST /api/dm/threads/:threadId/report — a participant files a low-key "something
// feels off" report (Phase 4, design C.12; dm.report) that routes to the SAFETY
// OFFICER and does NOT notify the mentor (an append-only dm_report + a
// dm.student_report monitoring-ledger entry; nothing appears on the thread). Gated by
// the party check on top of dm.report. Built DARK behind MENTOR_DM_ENABLED.
import { cookies } from 'next/headers'
import { getSql, reportDmThread, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request, ctx: RouteContext<'/api/dm/threads/[threadId]/report'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await reportDmThread({ sql: getSql(), sessionToken, params, body })
  return Response.json(out, { status })
}
