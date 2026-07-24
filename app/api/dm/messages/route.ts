// POST /api/dm/messages — a participant (a mentor OR the student) sends within an
// AUTHORIZED mentor-student pair (Phase 4, design C.2; dm.message). The service
// enforces canDirectMessage + closed-hours + frozen + content-flag checks and stores
// the ENCRYPTED body. Built DARK behind MENTOR_DM_ENABLED — a send refuses (409) with
// the flag off.
import { cookies } from 'next/headers'
import { getSql, sendDmMessage, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await sendDmMessage({ sql: getSql(), sessionToken, body })
  return Response.json(out, { status })
}
