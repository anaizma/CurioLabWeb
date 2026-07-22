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

/**
 * The consent types granted by a signed enrollment form (coupling D). These are
 * Block A of the paper form — required to participate (compliance-coppa.md Part 2
 * Stage 2). They live here, not in code, because Block composition is a
 * configuration concern per compliance-coppa.md Part 3 "Configuration, not code":
 * an unfavorable legal answer on separability becomes a value change, not a
 * migration.
 */
export type FormSourcedConsentType = 'enrollment' | 'data_collection'
export const FORM_SOURCED_CONSENT_TYPES: readonly FormSourcedConsentType[] = [
  'enrollment',
  'data_collection',
] as const

/** The object-storage key prefix under which signed enrollment scans are stored. */
export const SIGNED_FORM_KEY_PREFIX = 'enrollment/signed-forms'
/** The default content type recorded for an uploaded signed form. */
export const SIGNED_FORM_CONTENT_TYPE = 'application/pdf'

export interface AppConfig {
  dedupeWindowMs: number
  /** Consent types created form-sourced on enrollment (coupling D). */
  formSourcedConsentTypes: readonly FormSourcedConsentType[]
  /** The consent `reason` for a form-sourced grant (never safeguarding here). */
  formSourcedConsentReason: 'standard' | 'safeguarding'
  /** Storage key prefix for signed enrollment forms. */
  signedFormKeyPrefix: string
  /** Default content type for a stored signed form. */
  signedFormContentType: string
}

export const defaultConfig: AppConfig = {
  dedupeWindowMs: DEDUPE_WINDOW_MS,
  formSourcedConsentTypes: FORM_SOURCED_CONSENT_TYPES,
  formSourcedConsentReason: 'standard',
  signedFormKeyPrefix: SIGNED_FORM_KEY_PREFIX,
  signedFormContentType: SIGNED_FORM_CONTENT_TYPE,
}
