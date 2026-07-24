// POST /api/ops/safety-officers — name a chapter's independent safety officer
// (safety_officer.assign, director/admin). Mentor-student DM Phase 1, built DARK
// behind MENTOR_DM_ENABLED. Refuses the not-a-peer case with an opaque 409.
import { cookies } from 'next/headers'
import { getSql, assignSafetyOfficer, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await assignSafetyOfficer({ sql: getSql(), sessionToken, body })
  return Response.json(out, { status })
}
