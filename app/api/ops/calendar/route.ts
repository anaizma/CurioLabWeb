// GET  /api/ops/calendar — the staff calendar view, audience-filtered
//      (calendar.view; a mentor sees mentor-audience events, a director all).
// POST /api/ops/calendar — create a chapter calendar event (calendar.manage,
//      chapter_director; platform_admin via override).
import { cookies } from 'next/headers'
import { getSql, listStaffCalendar, createCalendarEvent, SESSION_COOKIE } from '@curiolab/http'

export async function GET(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const query = Object.fromEntries(new URL(req.url).searchParams)
  const { status, body } = await listStaffCalendar({ sql: getSql(), sessionToken, query })
  return Response.json(body, { status })
}

export async function POST(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await createCalendarEvent({ sql: getSql(), sessionToken, body })
  return Response.json(out, { status })
}
