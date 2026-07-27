// POST /api/auth/password/reset-request — uniform response, no account-existence
// oracle (05-api-surface.md). The controller mints and persists the token; THIS
// adapter owns delivery.
//
// Guarded like the other public forms: Turnstile in front, then a per-email/per-IP
// throttle, because an unthrottled reset endpoint lets anyone mail-bomb a known
// address. Both guards run BEFORE the controller, and the throttle refusal is a
// generic 429 that reveals nothing about whether the account exists.
//
// THE NO-ORACLE PROPERTY, restated because delivery is where it would break: the
// 202 is returned in every branch. Unknown identifier, known identifier, send
// succeeded, send threw, route not implemented — one response, one status, one
// body, and the send happens after the decision rather than gating it. The
// controller catches a thrown deliver() for the same reason.
import { getSql, requestPasswordReset } from '@curiolab/http'
import { clientIp, verifyTurnstile, turnstileRefusal, TURNSTILE_FIELD } from '@/lib/turnstile'
import { resolveAppUrl } from '@/lib/app-url'
import { accountEmail, sendPasswordResetEmail } from '@/lib/emails/auth-mail'
import {
  checkAndRecord,
  emailAndIpBuckets,
  rateLimitRefusal,
  RESET_EMAIL_LIMIT,
  RESET_IP_LIMIT,
} from '@/lib/rate-limit'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const ip = clientIp(req)

  const bot = await verifyTurnstile(body[TURNSTILE_FIELD], ip)
  if (!bot.ok) {
    console.warn('[auth/password/reset-request] turnstile rejected:', bot.errorCodes?.join(',') ?? 'unknown')
    return turnstileRefusal()
  }

  // The form posts `identifier` (login resolves an account by email OR username),
  // so that is what the per-account bucket is keyed on; `email` is still read
  // first for any older caller that posts it.
  const identifier =
    typeof body.email === 'string' ? body.email
    : typeof body.identifier === 'string' ? body.identifier
    : null
  const limited = await checkAndRecord(
    getSql(),
    'password-reset',
    emailAndIpBuckets(identifier, ip, RESET_EMAIL_LIMIT, RESET_IP_LIMIT),
  )
  if (!limited.ok) {
    console.warn(`[auth/password/reset-request] rate limited on ${limited.exceeded}`)
    return rateLimitRefusal(limited.retryAfterSeconds)
  }

  const appUrl = resolveAppUrl(req)
  const { status, body: out } = await requestPasswordReset({
    sql: getSql(),
    body,
    deliver: async (d) => {
      // Only the adult self-serve route is wired today. A minor's reset routes to
      // a verified guardian or to the Chapter Director, which needs a recipient
      // resolver and copy addressed to someone other than the account holder;
      // that flow is deliberately out of scope, and logging the ROUTE (never the
      // token) is how an operator sees one waiting.
      if (d.route !== 'self_email') {
        console.warn(
          `[auth/password/reset-request] route "${d.route}" is not wired; no email sent for account ${d.accountId}`,
        )
        return
      }
      const to = await accountEmail(getSql(), d.accountId)
      if (to === null) {
        console.warn(
          `[auth/password/reset-request] account ${d.accountId} has no email address; nothing sent`,
        )
        return
      }
      // The token appears in exactly one place: this link. It is never logged.
      await sendPasswordResetEmail(to, `${appUrl}/reset-password/${d.token}`, d.expiresAt)
    },
  })
  return Response.json(out, { status })
}
