// GET /api/dm/threads — the caller's OWN mentor-student DM threads (Phase 4, design
// C.2): a student sees their thread(s); a mentor sees the pairs they are assigned.
// Each item carries the permanent visibility header + the who-can-read statement. A
// GET (read-exempt from the route manifest), dark-gated behind MENTOR_DM_ENABLED.
import { cookies } from 'next/headers'
import { getSql, listDmThreads, SESSION_COOKIE } from '@curiolab/http'

export async function GET() {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const { status, body } = await listDmThreads({ sql: getSql(), sessionToken })
  return Response.json(body, { status })
}
