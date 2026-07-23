// -------------------------------------------------------------------------
// Application-service tunables — VALUES, not code (compliance-coppa.md Part 3,
// "Configuration, not code"): the mechanism is stable regardless of the legal
// answer, so what flexes lives here as a constant and becomes a value change
// rather than a migration or a code edit.
// -------------------------------------------------------------------------

/**
 * The duplicate-suppression window for the Stage 1 public lead write
 * (`LeadService.submitLead`, POST /public/leads). A second lead on the same
 * `email` received within this many milliseconds of the first is treated as a
 * resubmission and suppressed, returning the existing lead. A parent who
 * genuinely re-enquires a season later is not blocked.
 *
 * NOTE: rate limiting per IP and per email, and the edge bot-check (Cloudflare
 * Turnstile or equivalent), are HTTP-layer concerns (05-api-surface "Abuse
 * handling") and are deliberately NOT implemented in this framework-agnostic
 * layer. Only the email dedupe lives here.
 */
export const LEAD_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * The Stage-1 lead expiry window (design §7.1): `createLead` stamps
 * `expires_at = created_at + 30 days`, the § 312.4(c)(1)(vii) retention/deletion
 * floor the unconverted-lead sweep (retention-sweep.ts) reads at request time. A
 * value, not a literal, so a policy change is a config edit, never a code change
 * (compliance-coppa.md Part 3 "Configuration, not code"). It mirrors the
 * retention config's CONSENT_SEEKING_WINDOW_MS deliberately — same 30 days.
 */
export const LEAD_EXPIRY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

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
 * Password-reset token lifetime (05-api-surface POST /auth/password/reset). A
 * reset token is short-lived — long enough to reach the recipient and be used,
 * short enough that a leaked-but-unused link goes stale quickly. Validity is
 * evaluated at DECISION TIME against `now` (like sessions/invites), never a
 * sweeper. A value, not a literal, so a policy change is a config edit, never a
 * code change (compliance-coppa.md Part 3 "Configuration, not code").
 */
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000 // 1 hour

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
/**
 * The default `verification_method` recorded when a guardianship edge is
 * verified (Flow A step 6). The spec/task refers to this informally as the
 * "signed_form_scan" method; the schema enum value that encodes it is
 * `signed_form_match` (02-data-model guardianship). `in_person_witnessed` is
 * supported as a per-call input override; `sms_form_match` is reserved for a
 * later SMS flow. A value, not a literal, per compliance-coppa.md Part 3
 * "Configuration, not code".
 */
export const GUARDIAN_VERIFICATION_METHOD: GuardianVerificationMethod = 'signed_form_match'

/**
 * The guardian name-match normalization (Flow A step 6, the authority floor).
 * We compare the accepting account's `legal_name` to
 * `enrollment_record.guardian_name_on_form` after, in order:
 *   1. Unicode NFC normalization (so combining vs precomposed forms compare equal),
 *   2. trimming leading/trailing whitespace,
 *   3. collapsing every internal whitespace run to a single space,
 *   4. locale-independent case folding (`toLowerCase`).
 *
 * This deliberately forgives ONLY casing and spacing — the differences a
 * transcriber introduces copying a signature onto a form — while treating a
 * genuinely different name as a mismatch, which on Flow A step 6 rejects the
 * edge and closes the account. Diacritics are PRESERVED (NFC, not stripped):
 * "Jose" and "José" are different names, because accent-stripping would
 * over-match and weaken the authority floor. Punctuation is likewise preserved.
 */
export function normalizeGuardianName(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Whether two names match under {@link normalizeGuardianName}. */
export function guardianNamesMatch(a: string, b: string): boolean {
  return normalizeGuardianName(a) === normalizeGuardianName(b)
}

/**
 * The Stage 2B (student section) NON-IDENTIFYING ALLOWLIST — the closed set of
 * keys a student may save on their own section (Stage2Service.saveStudentSection;
 * milestone-1-application-funnel.md v2 invariant 3: "2B collects no identifying
 * fields at all: no name, no email, no school", enforced by an allowlist so an
 * identifying field cannot be saved even if the form is tampered with). A key not
 * on this list is REJECTED, not silently stripped, so tampering fails loudly.
 *
 * Every key here is a non-identifying, student-authored answer. It lives here as a
 * VALUE, not in code (compliance-coppa.md Part 3 "Configuration, not code"): the
 * mechanism — reject anything off the list — is stable regardless of which
 * questions the 2B form asks this season, so a form change is a config edit.
 */
export const STAGE2_STUDENT_ALLOWED_FIELDS: readonly string[] = [
  'interests', // What do you like doing when you're not in school?
  'motivation', // Why do you want to join CurioLab?
  'curiosity', // What are you curious about right now?
  'proud_build', // Something you built/made/fixed and were proud of?
  'problem_to_fix', // A problem you wish someone would fix?
  'goals', // What do you hope to learn or make by your first semester?
  'prior_experience', // Any coding/building/making before? (optional)
] as const

/**
 * The identifying-key rejection pattern for Stage 2B. A defence-in-depth companion
 * to the allowlist: any 2B key that LOOKS identifying (name, email, school,
 * address, phone, a guardian/parent field, a birthday, a postal code, a username)
 * is rejected with a specific "identifying field" error, distinct from the generic
 * "not on the allowlist" rejection. The allowlist alone already rejects these
 * (none appear on it), so this only sharpens the signal when a tampered form tries
 * to smuggle a name/email/school through. No allowlisted key matches this pattern.
 */
export const STAGE2_IDENTIFYING_KEY_PATTERN =
  /name|e-?mail|school|address|phone|surname|contact|username|dob|birth|zip|postal|guardian|parent/i

/**
 * The from-address for the two BACKEND-owned application-funnel emails
 * (mail.ts). Defaults to Resend's shared SANDBOX sender `onboarding@resend.dev`,
 * which only delivers to the Resend account owner's own verified address until a
 * real domain is verified. Override via `APPLY_FROM_EMAIL` once a domain is
 * verified in Resend. A value, not a literal, per compliance-coppa.md Part 3
 * "Configuration, not code".
 */
export const APPLY_FROM_EMAIL: string = process.env.APPLY_FROM_EMAIL ?? 'onboarding@resend.dev'

/**
 * The public base URL the backend uses to build funnel links (e.g. the Stage-2
 * continue link `${APP_URL}/apply/parent/${rawToken}` in the student-filler
 * email). Read from `APP_URL` (docs/platform/deploy/env.example); defaults to the
 * documented placeholder so a keyless dev/CI run still produces a well-formed
 * link. A value, not a literal, per compliance-coppa.md Part 3.
 */
export const APP_URL: string = process.env.APP_URL ?? 'https://platform.example.org'

export interface AppConfig {
  /** The Stage 1 lead email dedupe window in ms (LeadService.createLead). */
  leadDedupeWindowMs: number
  /** The from-address for backend-owned funnel emails (mail.ts). */
  applyFromEmail: string
  /** The public base URL for building funnel links (Stage-2 continue link). */
  appUrl: string
  /** The Stage 1 lead expiry window in ms — createLead stamps created_at + this. */
  leadExpiryWindowMs: number
  /** The Stage 2B non-identifying allowlist: the only keys a student may save. */
  stage2StudentAllowedFields: readonly string[]
  /** The identifying-key pattern that fails a 2B save loudly (defence in depth). */
  stage2IdentifyingKeyPattern: RegExp
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
  /** Password-reset token lifetime in ms (1 hour), evaluated at decision time. */
  passwordResetTtlMs: number
  /** delivery_status stamped on a freshly issued invite (delivery deferred). */
  inviteInitialDeliveryStatus: InviteInitialDeliveryStatus
  /** relationship recorded on a guardian-accept guardianship edge. */
  guardianRelationshipDefault: GuardianRelationship
  /** the intended verification_method on a pending guardianship edge. */
  guardianVerificationMethod: GuardianVerificationMethod
  /** the guardian name-match predicate (Flow A step 6); a config-not-code tunable. */
  guardianNameMatch: (nameOnAccount: string, nameOnForm: string) => boolean
}

export const defaultConfig: AppConfig = {
  leadDedupeWindowMs: LEAD_DEDUPE_WINDOW_MS,
  applyFromEmail: APPLY_FROM_EMAIL,
  appUrl: APP_URL,
  leadExpiryWindowMs: LEAD_EXPIRY_WINDOW_MS,
  stage2StudentAllowedFields: STAGE2_STUDENT_ALLOWED_FIELDS,
  stage2IdentifyingKeyPattern: STAGE2_IDENTIFYING_KEY_PATTERN,
  formSourcedConsentTypes: FORM_SOURCED_CONSENT_TYPES,
  formSourcedConsentReason: 'standard',
  signedFormKeyPrefix: SIGNED_FORM_KEY_PREFIX,
  signedFormContentType: SIGNED_FORM_CONTENT_TYPE,
  inviteTtlMs: INVITE_TTL_MS,
  passwordResetTtlMs: PASSWORD_RESET_TTL_MS,
  inviteInitialDeliveryStatus: INVITE_INITIAL_DELIVERY_STATUS,
  guardianRelationshipDefault: GUARDIAN_RELATIONSHIP_DEFAULT,
  guardianVerificationMethod: GUARDIAN_VERIFICATION_METHOD,
  guardianNameMatch: guardianNamesMatch,
}
