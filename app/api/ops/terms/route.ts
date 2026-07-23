// POST /api/ops/terms — create a term in a chapter (term.manage, chapter_director).
import { cookies } from 'next/headers'
import { getSql, createTerm, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await createTerm({ sql: getSql(), sessionToken, body })
  return Response.json(out, { status })
}
