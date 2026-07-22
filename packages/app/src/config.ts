// -------------------------------------------------------------------------
// Application-service tunables — VALUES, not code (compliance-coppa.md Part 3,
// "Configuration, not code"): the mechanism is stable regardless of the legal
// answer, so what flexes lives here as a constant and becomes a value change
// rather than a migration or a code edit.
// -------------------------------------------------------------------------

/**
 * The duplicate-suppression window for POST /public/apply. A second application
 * on the same `(guardian_email, applicant_name)` received within this many
 * milliseconds of the first is treated as a resubmission and suppressed. The
 * public form is idempotent within a submission session, but a family who
 * genuinely re-applies a season later is not blocked.
 *
 * NOTE: rate limiting per IP and per email, and the edge bot-check (Cloudflare
 * Turnstile or equivalent), are HTTP-layer concerns (05-api-surface "Abuse
 * handling") and are deliberately NOT implemented in this framework-agnostic
 * layer. Only the (guardian_email, applicant_name) dedupe lives here.
 */
export const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours

export interface AppConfig {
  dedupeWindowMs: number
}

export const defaultConfig: AppConfig = {
  dedupeWindowMs: DEDUPE_WINDOW_MS,
}
