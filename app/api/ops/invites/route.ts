// GET  /api/ops/invites — the pending-invite list (invite.read; never the token).
// POST /api/ops/invites — issue an invite (member.invite).
import { cookies } from 'next/headers'
import { getSql, issueInvite, listInvites, SESSION_COOKIE } from '@curiolab/http'

export async function GET(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const query = Object.fromEntries(new URL(req.url).searchParams)
  const { status, body } = await listInvites({ sql: getSql(), sessionToken, query })
  return Response.json(body, { status })
}

export async function POST(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await issueInvite({ sql: getSql(), sessionToken, body })
  return Response.json(out, { status })
}
