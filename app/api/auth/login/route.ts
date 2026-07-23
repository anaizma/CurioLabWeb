// POST /api/auth/login — verify credentials, mint a session, set the opaque cookie.
import { cookies } from 'next/headers'
import { getSql, login, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const result = await login({ sql: getSql(), body })
  if (result.session?.token) {
    const store = await cookies()
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
