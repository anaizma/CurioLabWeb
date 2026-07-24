// GET /api/ops/dm/reports?chapterId=… — the safety officer's view of the student
// "something feels off" reports in their chapter (Phase 4, design C.12; dm.oversee).
// The report routes to the safety officer's view: this is it. A non-officer / the
// mentor gets an opaque 403. A GET (read-exempt from the route manifest), dark-gated
// behind MENTOR_DM_ENABLED.
import { cookies } from 'next/headers'
import { getSql, listDmReports, SESSION_COOKIE } from '@curiolab/http'

export async function GET(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const query = Object.fromEntries(new URL(req.url).searchParams)
  const { status, body } = await listDmReports({ sql: getSql(), sessionToken, query })
  return Response.json(body, { status })
}
