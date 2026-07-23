// POST /api/lab/reports — file a moderation report (feed.report).
import { cookies } from 'next/headers'
import { getSql, fileReport, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await fileReport({ sql: getSql(), sessionToken, body })
  return Response.json(out, { status })
}
