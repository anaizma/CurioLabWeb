// POST /api/auth/totp — finish a `totpRequired` login: verify the second factor
// (TOTP or backup code) against the pending-2FA token and set the session cookie.
import { cookies } from 'next/headers'
import { getSql, submitTotp, clientIpFromRequest, readJson, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request) {
  const body = await readJson(req)
  const result = await submitTotp({ sql: getSql(), body, clientIp: clientIpFromRequest(req) })
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
