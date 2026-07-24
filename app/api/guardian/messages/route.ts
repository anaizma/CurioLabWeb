// POST /api/guardian/messages — a guardian creates a thread or appends to their
//      own (message.send). Body { threadId?, subject?, body, childAccountId?,
//      chapterId? }. sender_role is derived server-side (a client role is ignored).
// GET  /api/guardian/messages — the guardian's own threads + nested messages
//      (message.view_own; guardian-scoped).
import { cookies } from 'next/headers'
import { getSql, submitMessage, viewGuardianMessages, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await submitMessage({ sql: getSql(), sessionToken, body })
  return Response.json(out, { status })
}

export async function GET() {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const { status, body } = await viewGuardianMessages({ sql: getSql(), sessionToken })
  return Response.json(body, { status })
}
