// GET /api/guardian/calendar — the guardian's child-chapter parent-audience
//     calendar events (guardian.view_calendar; unioned across the guardian's
//     verified children, each event tagged with its chapterId).
import { cookies } from 'next/headers'
import { getSql, listGuardianCalendar, SESSION_COOKIE } from '@curiolab/http'

export async function GET() {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const { status, body } = await listGuardianCalendar({ sql: getSql(), sessionToken })
  return Response.json(body, { status })
}
