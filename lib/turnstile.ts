// Cloudflare Turnstile — the bot check in front of the PUBLIC, unauthenticated
// forms (apply, contact, newsletter, password-reset request, login).
//
// The site key is public by design (it is rendered into the page markup) and is
// passed from a server component down to the widget, so it needs no NEXT_PUBLIC_
// duplicate. The SECRET key never leaves the server and is used only here, to
// redeem the one-time token the widget produces.
//
// POSTURE: when TURNSTILE_SECRET_KEY is unset the check is DISABLED and every
// request passes, mirroring how mail.ts degrades to a NoopMailer without
// RESEND_API_KEY, so a fresh dev/CI checkout runs with no secrets. That is a
// fail-OPEN default: any deployment that serves the public apply page MUST set
// the secret, and `turnstileConfigured()` is exported so a health check can
// assert it. Once the secret IS set, a missing/invalid/replayed token is refused.

/** The Cloudflare endpoint that redeems a Turnstile token. */
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** The field name the widget posts and every route reads. */
export const TURNSTILE_FIELD = 'turnstileToken'

/** The public site key for the widget, or null when Turnstile is not configured. */
export function turnstileSiteKey(): string | null {
  const k = process.env.TURNSTILE_SITE_KEY
  return k === undefined || k === '' ? null : k
}

/** Whether the server can actually verify tokens (the secret is present). */
export function turnstileConfigured(): boolean {
  const s = process.env.TURNSTILE_SECRET_KEY
  return s !== undefined && s !== ''
}

export interface TurnstileResult {
  ok: boolean
  /** Cloudflare's error codes, for logging only — never surfaced to the client. */
  errorCodes?: string[]
}

/**
 * Redeem a Turnstile token with Cloudflare. Tokens are single-use and short-lived,
 * so a replayed or stale token fails here. `remoteIp` is optional but tightens the
 * check when the caller can determine it.
 *
 * Returns ok:true when Turnstile is not configured (see POSTURE above). A network
 * failure reaching Cloudflare is treated as a FAILURE, not a pass, so an outage
 * cannot silently disable the check on a configured deployment.
 */
export async function verifyTurnstile(token: unknown, remoteIp?: string | null): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (secret === undefined || secret === '') {
    console.warn('[turnstile] TURNSTILE_SECRET_KEY unset — bot check DISABLED for this request')
    return { ok: true }
  }
  if (typeof token !== 'string' || token === '') {
    return { ok: false, errorCodes: ['missing-input-response'] }
  }

  const form = new URLSearchParams({ secret, response: token })
  if (remoteIp !== undefined && remoteIp !== null && remoteIp !== '') form.set('remoteip', remoteIp)

  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      // Do not let a hung Cloudflare call hold the request open indefinitely.
      signal: AbortSignal.timeout(10_000),
    })
    const body = (await res.json().catch(() => ({}))) as {
      success?: boolean
      'error-codes'?: string[]
    }
    if (body.success === true) return { ok: true }
    return { ok: false, errorCodes: body['error-codes'] ?? ['verification-failed'] }
  } catch (err) {
    console.error('[turnstile] verification call failed:', err)
    return { ok: false, errorCodes: ['internal-error'] }
  }
}

/**
 * The client IP as seen behind a proxy (Fly/Cloudflare set these). Used both as
 * Turnstile's `remoteip` and as the rate-limit key. Falls back to null rather than
 * to a shared placeholder, so an unknown IP never buckets every caller together.
 */
export function clientIp(req: Request): string | null {
  const h = req.headers
  const forwarded = h.get('x-forwarded-for')
  if (forwarded !== null && forwarded !== '') {
    const first = forwarded.split(',')[0]?.trim()
    if (first !== undefined && first !== '') return first
  }
  const real = h.get('x-real-ip') ?? h.get('cf-connecting-ip') ?? h.get('fly-client-ip')
  return real !== null && real !== '' ? real : null
}

/** The uniform refusal a route returns when the bot check fails. */
export function turnstileRefusal(): Response {
  return Response.json({ error: 'bot_check_failed' }, { status: 403 })
}
