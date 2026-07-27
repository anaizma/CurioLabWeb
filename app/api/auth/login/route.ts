// POST /api/auth/login — verify credentials, mint a session, set the opaque cookie.
//
// Guarded by the database-backed per-account/per-IP throttle, which is the real
// credential-stuffing brake. Turnstile is deliberately NOT in front of login:
// it fails closed on a Cloudflare outage, which would lock every operator —
// including the platform admins — out of the portal for a reason unrelated to
// this system. The public forms that SEND MAIL (apply, contact, password-reset
// request) do carry it, because there an outage costs a delayed enquiry rather
// than total loss of access.
import { cookies } from 'next/headers'
import { getSql, login, SESSION_COOKIE } from '@curiolab/http'
import { clientIp } from '@/lib/turnstile'
import { newSignInNotifier, userAgentOf } from '@/lib/emails/new-sign-in'
import {
  checkAndRecord,
  emailAndIpBuckets,
  rateLimitRefusal,
  LOGIN_EMAIL_LIMIT,
  LOGIN_IP_LIMIT,
} from '@/lib/rate-limit'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const ip = clientIp(req)

  // Login resolves an account by email OR username, so the per-account bucket is
  // keyed on `identifier` (what the form actually posts), not `email`.
  const identifier = typeof body.identifier === 'string' ? body.identifier : null
  const limited = await checkAndRecord(
    getSql(),
    'login',
    emailAndIpBuckets(identifier, ip, LOGIN_EMAIL_LIMIT, LOGIN_IP_LIMIT),
  )
  if (!limited.ok) {
    console.warn(`[auth/login] rate limited on ${limited.exceeded}`)
    return rateLimitRefusal(limited.retryAfterSeconds)
  }

  const result = await login({
    sql: getSql(),
    body,
    clientIp: ip,
    userAgent: userAgentOf(req),
    notifyNewSignIn: newSignInNotifier(req),
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
