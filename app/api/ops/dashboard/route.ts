// GET /api/ops/dashboard — the count-card summary for a chapter (application.read).
import { cookies } from 'next/headers'
import { getSql, opsDashboard, SESSION_COOKIE } from '@curiolab/http'

export async function GET(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const query = Object.fromEntries(new URL(req.url).searchParams)
  const { status, body } = await opsDashboard({ sql: getSql(), sessionToken, query })
  return Response.json(body, { status })
}
