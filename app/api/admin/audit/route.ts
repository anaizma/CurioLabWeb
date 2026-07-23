// GET /api/admin/audit — a platform reader reads the cross-chapter audit trail
// (audit.view global). Each read logs one audit.read entry.
import { cookies } from 'next/headers'
import { getSql, readAdminAudit, SESSION_COOKIE } from '@curiolab/http'

export async function GET(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const query = Object.fromEntries(new URL(req.url).searchParams)
  const { status, body } = await readAdminAudit({ sql: getSql(), sessionToken, query })
  return Response.json(body, { status })
}
