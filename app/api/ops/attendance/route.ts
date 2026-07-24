// GET /api/ops/attendance — the staff attendance roster (attendance.view). Either
//     ?sessionEventId= (who is absent/late for that one session) OR
//     ?chapterId=&termId= (the chapter's exceptions for a term). Display names only.
import { cookies } from 'next/headers'
import { getSql, listStaffAttendance, SESSION_COOKIE } from '@curiolab/http'

export async function GET(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const query = Object.fromEntries(new URL(req.url).searchParams)
  const { status, body } = await listStaffAttendance({ sql: getSql(), sessionToken, query })
  return Response.json(body, { status })
}
