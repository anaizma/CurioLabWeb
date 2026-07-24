// POST /api/ops/invites/director-requests — initiate a two-person director
// invite (member.invite_director). Returns a pending request id and NO token; a
// second, distinct director must approve before the director invite is minted.
import { cookies } from 'next/headers'
import { getSql, initiateDirectorInvite, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await initiateDirectorInvite({ sql: getSql(), sessionToken, body })
  return Response.json(out, { status })
}
