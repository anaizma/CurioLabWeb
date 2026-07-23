// POST /api/ops/newsletter — draft a newsletter issue (newsletter.draft).
import { cookies } from 'next/headers'
import { getSql, draftNewsletter, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await draftNewsletter({ sql: getSql(), sessionToken, body })
  return Response.json(out, { status })
}
