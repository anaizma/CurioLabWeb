// POST /api/ops/dm/suspensions — the safety officer INITIATES a guardian-visibility
// suspension (Phase 3, design C.8; dm.suspend_guardian_visibility). Requires a
// recorded reason; returns the mandatory-reporter checkpoint content. It does NOT
// take effect until a second adult acknowledges. Dark-gated behind MENTOR_DM_ENABLED.
import { cookies } from 'next/headers'
import { getSql, initiateDmSuspension, SESSION_COOKIE, readJson } from '@curiolab/http'

export async function POST(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const body = await readJson(req)
  const { status, body: out } = await initiateDmSuspension({ sql: getSql(), sessionToken, body })
  return Response.json(out, { status })
}
