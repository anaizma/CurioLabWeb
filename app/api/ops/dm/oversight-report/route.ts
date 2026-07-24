// GET /api/ops/dm/oversight-report?chapterId=&from=&to= — the QUARTERLY officer-
// oversight export for the board (Phase 3, design C.7): coverage, flags raised +
// disposition, suspensions, and review counts over the window. GET (read-exempt
// from the route manifest), gated on dm.oversee, dark-gated behind MENTOR_DM_ENABLED.
import { cookies } from 'next/headers'
import { getSql, readDmOversightReport, SESSION_COOKIE } from '@curiolab/http'

export async function GET(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const query = Object.fromEntries(new URL(req.url).searchParams)
  const { status, body } = await readDmOversightReport({ sql: getSql(), sessionToken, query })
  return Response.json(body, { status })
}
