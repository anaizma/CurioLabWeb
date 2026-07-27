// POST /api/auth/sessions/revoke — end one of the caller's own sessions, or all
// of them ("sign out everywhere"). Self-scoped in the controller's query, no
// registry capability (same posture as POST /api/auth/logout).
//
// When the caller ends the session they are using, the controller says so and
// this adapter clears the cookie, so the browser is not left holding a token the
// server has already revoked.
import { cookies } from 'next/headers'
import { getSql, revokeSessions, readJson, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request) {
  const store = await cookies()
  const sessionToken = store.get(SESSION_COOKIE)?.value ?? null
  const body = await readJson(req)
  const result = await revokeSessions({ sql: getSql(), sessionToken, body })
  if (result.session && result.session.token === null) {
    store.delete(SESSION_COOKIE)
  }
  return Response.json(result.body, { status: result.status })
}
