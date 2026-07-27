// GET /api/auth/sessions — the caller's own live sessions, for the "Account &
// security" panel in portal settings. Self-scoped, no registry capability (the
// authority is ownership of the session, like GET /api/auth/session). Never
// returns a token or a token hash.
import { cookies } from 'next/headers'
import { getSql, listSessions, SESSION_COOKIE } from '@curiolab/http'

export async function GET() {
  const store = await cookies()
  const sessionToken = store.get(SESSION_COOKIE)?.value ?? null
  const { status, body } = await listSessions({ sql: getSql(), sessionToken })
  return Response.json(body, { status })
}
