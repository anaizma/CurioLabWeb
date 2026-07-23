// GET /api/ops/audit — a Chapter Director reads their chapter's audit trail
// (audit.view, chapter-scoped). Each read logs one audit.read entry.
import { cookies } from 'next/headers'
import { getSql, readOpsAudit, SESSION_COOKIE } from '@curiolab/http'

export async function GET(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const query = Object.fromEntries(new URL(req.url).searchParams)
  const { status, body } = await readOpsAudit({ sql: getSql(), sessionToken, query })
  return Response.json(body, { status })
}
