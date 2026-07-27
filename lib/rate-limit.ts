// Decision-time rate limiting for the PUBLIC, unauthenticated form endpoints.
//
// Backed by the `public_form_attempt` ledger (migration 0044) rather than process
// memory, so the limit survives a restart and holds across multiple instances.
// Each check counts the rows for one bucket inside a rolling window; an accepted
// request records a new row. Mirrors the invite rate limiter's decision-time
// counting: nothing sweeps or expires, the window is simply `at > now - window`.

import type { Sql } from 'postgres'

/** One limit: at most `max` accepted attempts per `windowMs` for a bucket. */
export interface Limit {
  windowMs: number
  max: number
}

/**
 * The apply-form limits. Deliberately generous for a real family (a parent who
 * mistypes their address and retries is not a bot) and tight enough that the
 * endpoint cannot be used to mail-bomb the director or burn the Resend quota.
 */
export const APPLY_EMAIL_LIMIT: Limit = { windowMs: 60 * 60 * 1000, max: 3 }
export const APPLY_IP_LIMIT: Limit = { windowMs: 60 * 60 * 1000, max: 10 }

/** The contact form. Same shape as apply: it relays a message by email. */
export const CONTACT_EMAIL_LIMIT: Limit = { windowMs: 60 * 60 * 1000, max: 5 }
export const CONTACT_IP_LIMIT: Limit = { windowMs: 60 * 60 * 1000, max: 10 }

/**
 * Password-reset requests. Keyed per email so one account cannot be mail-bombed,
 * and per IP so a sprayer cannot walk a list of addresses. The endpoint returns a
 * uniform response either way, so throttling leaks no account-existence signal.
 */
export const RESET_EMAIL_LIMIT: Limit = { windowMs: 60 * 60 * 1000, max: 3 }
export const RESET_IP_LIMIT: Limit = { windowMs: 60 * 60 * 1000, max: 15 }

/**
 * Login. The per-IP bucket is the credential-stuffing brake; the per-email bucket
 * is deliberately looser than the reset limits because a real person fat-fingering
 * their own password several times must not be locked out of their own account.
 */
export const LOGIN_EMAIL_LIMIT: Limit = { windowMs: 15 * 60 * 1000, max: 10 }
export const LOGIN_IP_LIMIT: Limit = { windowMs: 15 * 60 * 1000, max: 30 }

export interface RateLimitCheck {
  /** True when the request is within every limit and was recorded. */
  ok: boolean
  /** Which bucket rejected it ('email' | 'ip'), for logging only. */
  exceeded?: 'email' | 'ip'
  /** Seconds the caller should wait, for the Retry-After header. */
  retryAfterSeconds?: number
}

interface Bucket {
  kind: 'email' | 'ip'
  value: string | null
  limit: Limit
}

/**
 * Check every bucket and, if all pass, record ONE attempt row per identifiable
 * bucket. A bucket with a null value (e.g. an IP that could not be resolved
 * behind a proxy) is skipped rather than collapsed into a shared key, so unknown
 * callers never share one limit.
 *
 * Fails OPEN on a database error: the throttle is a safeguard, and a transient
 * DB fault must not take the apply form down. Turnstile remains in front.
 */
export async function checkAndRecord(
  sql: Sql,
  scope: string,
  buckets: readonly Bucket[],
): Promise<RateLimitCheck> {
  try {
    const live = buckets.filter((b): b is Bucket & { value: string } => b.value !== null && b.value !== '')

    for (const b of live) {
      const since = new Date(Date.now() - b.limit.windowMs)
      const [row] = await sql`
        select count(*)::int as n, min(at) as oldest
        from public_form_attempt
        where scope = ${scope} and bucket_kind = ${b.kind} and bucket = ${b.value} and at > ${since}
      `
      const n = (row?.n as number | undefined) ?? 0
      if (n >= b.limit.max) {
        // The window frees up when the OLDEST counted attempt falls out of it.
        const oldest = row?.oldest as Date | undefined
        const freesAt = oldest ? oldest.getTime() + b.limit.windowMs : Date.now() + b.limit.windowMs
        const retryAfterSeconds = Math.max(1, Math.ceil((freesAt - Date.now()) / 1000))
        return { ok: false, exceeded: b.kind, retryAfterSeconds }
      }
    }

    for (const b of live) {
      await sql`
        insert into public_form_attempt (scope, bucket_kind, bucket)
        values (${scope}, ${b.kind}, ${b.value})
      `
    }
    return { ok: true }
  } catch (err) {
    console.error(`[rate-limit] check failed for scope=${scope}, allowing the request:`, err)
    return { ok: true }
  }
}

/** Build the standard email+ip bucket pair for a public form. */
export function emailAndIpBuckets(
  email: string | null,
  ip: string | null,
  emailLimit: Limit,
  ipLimit: Limit,
): Bucket[] {
  return [
    { kind: 'email', value: email === null ? null : email.trim().toLowerCase(), limit: emailLimit },
    { kind: 'ip', value: ip, limit: ipLimit },
  ]
}

/** The uniform refusal a throttled route returns. */
export function rateLimitRefusal(retryAfterSeconds?: number): Response {
  return Response.json(
    { error: 'rate_limited' },
    {
      status: 429,
      headers: retryAfterSeconds ? { 'Retry-After': String(retryAfterSeconds) } : undefined,
    },
  )
}
