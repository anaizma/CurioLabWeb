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

/**
 * Invite token lifetime. "Token expiry is 14 days on every invite, evaluated at
 * decision time" (06-onboarding-flows, shared parameters; 02-data-model invite
 * `expires_at`). A value, not a literal, so a policy change is a config edit and
 * never a code change (compliance-coppa.md Part 3 "Configuration, not code").
 */
export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000 // 14 days

/**
 * The `delivery_status` a freshly issued invite carries. Email delivery is
 * deferred this milestone (no Resend), and the enum has no "queued" value, so a
 * new invite is recorded `sent`; the real mailer (the future seam that consumes
 * the returned token) and the Resend webhook update this thereafter
 * (02-data-model: delivery_status "fed by Resend webhook").
 */
export type InviteInitialDeliveryStatus = 'sent' | 'delivered' | 'bounced' | 'complained'
export const INVITE_INITIAL_DELIVERY_STATUS: InviteInitialDeliveryStatus = 'sent'

/**
 * The guardianship edge minted on a guardian accept. `relationship` defaults to
 * `guardian` (the generic case; a form may later specialize it) and the intended
 * `verification_method` is `signed_form_match` — the name-on-account/name-on-form
 * check performed at step 4 (Flow A step 6). The edge is created `pending` with
 * `verified_by`/`verified_at`/`source_ref` null; it carries NO authority until
 * verification (04-state-machines guardianship "(none) -> pending").
 */
export type GuardianRelationship = 'parent' | 'guardian' | 'other'
export const GUARDIAN_RELATIONSHIP_DEFAULT: GuardianRelationship = 'guardian'
export type GuardianVerificationMethod = 'signed_form_match' | 'in_person_witnessed' | 'sms_form_match'
export const GUARDIAN_VERIFICATION_METHOD: GuardianVerificationMethod = 'signed_form_match'

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
  /** Invite token lifetime in ms (14 days), evaluated at decision time. */
  inviteTtlMs: number
  /** delivery_status stamped on a freshly issued invite (delivery deferred). */
  inviteInitialDeliveryStatus: InviteInitialDeliveryStatus
  /** relationship recorded on a guardian-accept guardianship edge. */
  guardianRelationshipDefault: GuardianRelationship
  /** the intended verification_method on a pending guardianship edge. */
  guardianVerificationMethod: GuardianVerificationMethod
}

export const defaultConfig: AppConfig = {
  dedupeWindowMs: DEDUPE_WINDOW_MS,
  formSourcedConsentTypes: FORM_SOURCED_CONSENT_TYPES,
  formSourcedConsentReason: 'standard',
  signedFormKeyPrefix: SIGNED_FORM_KEY_PREFIX,
  signedFormContentType: SIGNED_FORM_CONTENT_TYPE,
  inviteTtlMs: INVITE_TTL_MS,
  inviteInitialDeliveryStatus: INVITE_INITIAL_DELIVERY_STATUS,
  guardianRelationshipDefault: GUARDIAN_RELATIONSHIP_DEFAULT,
  guardianVerificationMethod: GUARDIAN_VERIFICATION_METHOD,
}
