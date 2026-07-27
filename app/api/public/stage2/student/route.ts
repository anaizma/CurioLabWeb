// POST /api/public/stage2/student — 2B student section (student token in the body).
// Passes the resolved app URL through so the "review and submit" link this save
// emails to the parent points at the host the request actually arrived on.
import { getSql, saveStudentSection } from '@curiolab/http'
import { resolveAppUrl } from '@/lib/app-url'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await saveStudentSection({
    sql: getSql(),
    body,
    appUrl: resolveAppUrl(req),
  })
  return Response.json(out, { status })
}
