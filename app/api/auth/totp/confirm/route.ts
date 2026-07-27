// POST /api/auth/totp/confirm — confirm forced TOTP enrollment: verify the code,
// activate TOTP, return the one-time backup codes ONCE, and set the session cookie.
import { cookies } from 'next/headers'
import { getSql, confirmTotpEnrollment, clientIpFromRequest, readJson, SESSION_COOKIE } from '@curiolab/http'
import { userAgentOf } from '@/lib/emails/new-sign-in'

export async function POST(req: Request) {
  const body = await readJson(req)
  // The device is recorded so this browser is RECOGNISED on the next sign-in; no
  // notice fires here (it is the account's first session, and the person is
  // sitting in front of the enrollment screen that produced it).
  const result = await confirmTotpEnrollment({
    sql: getSql(),
    body,
    clientIp: clientIpFromRequest(req),
    userAgent: userAgentOf(req),
  })
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
