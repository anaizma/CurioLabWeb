// POST /api/ops/dm/enable — flip the chapter DM switch on (dm.enable,
// director/admin), refused unless the Part D preconditions hold (a safety officer,
// an insurance attestation, a current-term pod). Mentor-student DM Phase 1, built
// DARK behind MENTOR_DM_ENABLED — even enabled, the global flag must also be on.
import { cookies } from 'next/headers'
import { getSql, enableChapterDm, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await enableChapterDm({ sql: getSql(), sessionToken, body })
  return Response.json(out, { status })
}
