// POST /api/auth/totp/confirm — confirm forced TOTP enrollment: verify the code,
// activate TOTP, return the one-time backup codes ONCE, and set the session cookie.
import { cookies } from 'next/headers'
import { getSql, confirmTotpEnrollment, clientIpFromRequest, readJson, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request) {
  const body = await readJson(req)
  const result = await confirmTotpEnrollment({ sql: getSql(), body, clientIp: clientIpFromRequest(req) })
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
