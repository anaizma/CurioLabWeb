// POST   /api/auth/impersonate — platform_admin starts a 30-minute
//         impersonation session (read-only for a minor target); the returned
//         token becomes the session cookie.
// DELETE /api/auth/impersonate — ends the impersonation session and clears it.
import { cookies } from 'next/headers'
import { getSql, startImpersonation, endImpersonation, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request) {
  const store = await cookies()
  const sessionToken = store.get(SESSION_COOKIE)?.value ?? null
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const result = await startImpersonation({ sql: getSql(), sessionToken, body })
  if (result.session?.token) {
    store.set(SESSION_COOKIE, result.session.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
      expires: result.session.expiresAt,
    })
  }
  return Response.json(result.body, { status: result.status })
}

export async function DELETE() {
  const store = await cookies()
  const sessionToken = store.get(SESSION_COOKIE)?.value ?? null
  const result = await endImpersonation({ sql: getSql(), sessionToken })
  if (result.session && result.session.token === null) {
    store.delete(SESSION_COOKIE)
  }
  return Response.json(result.body, { status: result.status })
}
