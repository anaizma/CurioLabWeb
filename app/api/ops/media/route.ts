// POST /api/ops/media — attach media to the actor's own project (project.submit, own).
import { cookies } from 'next/headers'
import { getSql, attachMedia, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await attachMedia({ sql: getSql(), sessionToken, body })
  return Response.json(out, { status })
}
