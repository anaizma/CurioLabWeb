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
 * Per-kind invite token lifetimes (admin/director backend §4 token hardening).
 * The adult, self-managed kinds (mentor / staff / director / admin) get a SHORT
 * 72-hour window — a privileged link should go stale fast. A guardian invite gets
 * ~7 days, the slower family-onboarding clock. A student invite (not issuable
 * through the ops endpoint; seeded from a consented guardian) inherits the same
 * 7-day family window. All are evaluated at DECISION TIME against `now`, like
 * every other token in the codebase. Values, not literals, per compliance-coppa.md
 * Part 3 "Configuration, not code" — a policy change is a config edit.
 */
export const INVITE_ADULT_TTL_MS = 72 * 60 * 60 * 1000 // 72 hours
export const INVITE_GUARDIAN_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
export type InviteKindTtl = 'guardian' | 'student' | 'mentor' | 'staff' | 'director' | 'admin'
export const INVITE_TTL_MS_BY_KIND: Record<InviteKindTtl, number> = {
  mentor: INVITE_ADULT_TTL_MS,
  staff: INVITE_ADULT_TTL_MS,
  director: INVITE_ADULT_TTL_MS,
  admin: INVITE_ADULT_TTL_MS,
  guardian: INVITE_GUARDIAN_TTL_MS,
  student: INVITE_GUARDIAN_TTL_MS,
}

/**
 * Invite issuance rate limit (admin/director backend §4). A per-ISSUER cap: an
 * account may mint at most INVITE_RATE_LIMIT_MAX invites within a rolling
 * INVITE_RATE_LIMIT_WINDOW_MS window (counted over the invites it has issued).
 * A testable guard mirroring the lead dedupe window's decision-time counting,
 * so a compromised or runaway issuer cannot spray invites. Values, not literals.
 */
export const INVITE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour
export const INVITE_RATE_LIMIT_MAX = 30

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
 * §10 TOTP two-factor tunables (admin/director backend). Values, not literals,
 * per compliance-coppa.md Part 3 "Configuration, not code" — a policy change is a
 * config edit. The step/digits/window are RFC 6238 standards (interoperate with
 * any authenticator); the pending-2FA login state is deliberately SHORT (a
 * password was proven but no session exists yet); the rate limit caps second-
 * factor guessing at DECISION TIME over the recent attempt log.
 */
export const TOTP_STEP_SECONDS = 30
export const TOTP_DIGITS = 6
/** Accepted +/- steps at verification (RFC 6238 §5.2 clock-skew tolerance). */
export const TOTP_WINDOW_STEPS = 1
/** One-time recovery codes minted at enrollment confirm. */
export const TOTP_BACKUP_CODE_COUNT = 10
/** The short-lived pending-2FA login token lifetime (password proven, no session). */
export const TWO_FACTOR_PENDING_TTL_MS = 5 * 60 * 1000 // 5 minutes
/** The rolling window + cap for second-factor attempts (guessing rate limit). */
export const TOTP_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000 // 15 minutes
export const TOTP_RATE_LIMIT_MAX = 5
/** The issuer label shown in the authenticator app (the otpauth:// URI). */
export const TOTP_ISSUER = 'CurioLab'

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

/**
 * §5 consent-grant ledger — the REVIEW GATE. When FALSE (the default, and the
 * production posture until the legal review is complete), the new grant-ledger
 * PUBLIC-PUBLICATION behavior is entirely dormant: narrative/project/newsletter
 * publishing keeps its existing `consent` gates unchanged, and the
 * notify-and-object window does not run. When TRUE, the new gates additionally
 * require an active `public_publication` grant (and internal/platform access an
 * active `platform_account` grant) and the notify-and-object hold path engages.
 *
 * The grant-CAPTURE and per-grant REVOCATION mechanisms are always available
 * (they only WRITE the ledger); the flag gates only the public-publication
 * ENFORCEMENT, so production data is untouched until the flag is flipped
 * post-legal-review. A value, not a literal, per compliance-coppa.md Part 3
 * "Configuration, not code" — the legal flip is a config edit.
 */
export const CONSENT_GRANT_LEDGER_ENFORCED: boolean =
  process.env.CONSENT_GRANT_LEDGER_ENFORCED === 'true'

/**
 * §6 mentor eligibility as state — the REVIEW GATE. When FALSE (the default, and
 * the production posture until legal review), eligibility is RECORDED but never
 * blocks: a mentor's student-facing access is exactly as it is today, the `can`
 * eligibility predicate is dormant, and the auto-revoke sweep records nothing on
 * eligibility grounds. When TRUE, a mentor membership that is NOT currently
 * eligible (any of the four components missing or expired) no longer confers the
 * STUDENT-FACING capability set (`can` denies opaque out_of_scope), and the
 * eligibility sweep transitions a lapsed mentor active -> inactive with
 * reason = eligibility_lapsed.
 *
 * The eligibility-CAPTURE (recording clearances) and READ mechanisms are always
 * available (they only WRITE / READ the ledger); the flag gates only ENFORCEMENT,
 * so production data is untouched until the flag is flipped post-legal-review. A
 * value, not a literal, per compliance-coppa.md Part 3 "Configuration, not code".
 */
export const MENTOR_ELIGIBILITY_ENFORCED: boolean =
  process.env.MENTOR_ELIGIBILITY_ENFORCED === 'true'

/**
 * Mentor-student direct messaging (design Part D) — the GLOBAL build flag. When
 * FALSE (the default, and the production posture until the board, counsel, and
 * insurer sign off), the entire mentor-student DM feature is DARK: `canDirectMessage`
 * returns false, no DM send is accepted, and no real minor can be a party — even if
 * a chapter's DM switch was somehow recorded on. The mechanism is fully built and
 * tested against SYNTHETIC data behind this flag. When TRUE (only after the Part A/B
 * sign-off AND every Part D enable-precondition holds in the system), the per-chapter
 * switch governs. Mirrors CONSENT_GRANT_LEDGER_ENFORCED / MENTOR_ELIGIBILITY_ENFORCED:
 * a value, not a literal — the flip is a config edit, never a code change.
 *
 * COUNSEL-GATED: flipping this requires the Part B legal sign-off (the COPPA posture
 * change + the no-direct-messaging guard amendment). Building the feature imposes no
 * obligation to enable it (Part A.6).
 */
export const MENTOR_DM_ENABLED: boolean = process.env.MENTOR_DM_ENABLED === 'true'

/**
 * Mentor-student DM CLOSED HOURS (design C.4; Phase 2) — the DEFAULT allowed local
 * window for sends, `[open, close)` in the chapter's local wall-clock hour. Sends
 * are refused outside 07:00-21:00 local ("late-night one-on-one contact has no
 * program purpose"); a chapter may override per-chapter via `chapter.dm_open_hour`
 * / `dm_close_hour` (migration 0031), which take precedence when set. READS are
 * NEVER hours-gated. Values, not literals, per compliance-coppa.md Part 3
 * "Configuration, not code" — a policy change is a config edit.
 */
export const DM_OPEN_HOUR_DEFAULT = 7
export const DM_CLOSE_HOUR_DEFAULT = 21

/**
 * Mentor-student DM RETENTION carve-out (design C.11; Phase 2) — a clearly-labelled
 * PLACEHOLDER pending counsel. DM threads/messages are EXCLUDED from deletion-request
 * fulfillment and retained to the OUTER BOUND of Ohio's childhood-claim limitations
 * window (counsel to confirm the exact age; working assumption ~age 30, deliberately
 * not a round number). This constant records the working retention interval as a
 * duration from the subject's DOB; it is disclosed at consent (design C.10) as a
 * deliberate carve-out from the right-to-deletion policy. NOT YET legally confirmed
 * — do not treat as final. ~30 years in ms.
 */
export const DM_RETENTION_MS = 30 * 365 * 24 * 60 * 60 * 1000 // ~30 years (PLACEHOLDER, pending counsel)

/**
 * Mentor-student DM full-review TRANSITION THRESHOLD (design C.6; Phase 3) — a
 * clearly-labelled PLACEHOLDER pending the program lead. At this scale the safety
 * officer reads EVERYTHING (a complete chronological queue with read-receipts);
 * behavioral ranking / sampling is a deliberately DEFERRED, scale-triggered future
 * capability. This is the weekly-message-volume above which full review is deemed
 * infeasible and sampling/ranking would be DESIGNED. The oversight surface only
 * EXPOSES whether the chapter is over/under this line so the officer/board sees
 * when the model must change; nothing samples now. NOT YET set by the program lead
 * — do not treat as final. A value, not a literal (compliance-coppa.md Part 3).
 */
export const DM_FULL_REVIEW_MAX_WEEKLY_MESSAGES = 500 // PLACEHOLDER, pending the program lead

/**
 * Mentor-student DM guardian-visibility suspension expiry (design C.8; Phase 3).
 * A safety-officer suspension of a guardian's standing read access EXPIRES after
 * this interval, after which guardian visibility auto-restores UNLESS affirmatively
 * re-authorized (a new suspension). It never persists silently. 90 days, per the
 * board decision (design decision 6). A value, not a literal.
 */
export const DM_VISIBILITY_SUSPENSION_MS = 90 * 24 * 60 * 60 * 1000 // 90 days

/**
 * Mentor-student DM mandatory-reporter checkpoint (design C.8; Phase 3) — the
 * content the suspension flow surfaces at the moment a safety officer suspends
 * guardian visibility, because suspending on the theory that the guardian may be
 * the risk is very likely already reportable-suspicion territory. The BACKEND
 * returns this content in the initiation payload AND records that it was surfaced
 * (dm_visibility_suspension.reporter_checkpoint_ack); the interface shows it. The
 * hotline details/wording are a PLACEHOLDER pending confirmation (design "Open").
 */
export const DM_REPORTER_CHECKPOINT = {
  title: 'Mandatory-reporter checkpoint',
  body:
    'Suspending guardian visibility on the theory that the guardian may be the risk ' +
    'is very likely already reportable-suspicion territory. As a mandatory reporter, ' +
    'consider whether this must be reported now — do not leave it to later judgment.',
  // PLACEHOLDER pending confirmation of the exact Ohio hotline details (design "Open").
  ohioHotline: '1-855-O-H-CHILD (1-855-642-4453)',
} as const

/**
 * §5 Rule 3 — the notify-and-object window. A standing `public_publication` grant
 * is not blanket pre-approval: a nominated item publishes only if the guardian
 * does not object within N days (default 5). A value, not a literal.
 */
export const PUBLICATION_HOLD_WINDOW_MS = 5 * 24 * 60 * 60 * 1000 // 5 days

/**
 * §5 the six grant types and their renewal clocks (the §5 detail table). Each
 * grant expires on its own clock: per cohort/term, annual, or standing (never
 * expires). `capture` sets expires_at = granted_at + this (null = standing). A
 * term is taken as ~180 days; the annual clock ~365. Values, not literals.
 */
export type ConsentGrantType =
  | 'program_participation'
  | 'platform_account'
  | 'public_publication'
  | 'photo_video_likeness'
  | 'emergency_medical_pickup'
  | 'verification_link_sharing'
  // mentor-student DM consent (design C.3, C.10; Phase 1). A guardian's consent
  // for a supervised mentor-student messaging channel for their child. Captured as
  // a SIGNED FORM (a click is refused — deliberate friction that tests guardian
  // engagement), with a non-null evidence_artifact_ref. Expires at term end,
  // independently revocable via the existing per-grant revoke.
  | 'mentor_dm'

export type ConsentGrantMethod =
  | 'click'
  | 'signed_form'
  | 'monetary_transaction'
  | 'video_call'
  | 'id_verification'

/** The FTC-approved strong methods (everything but the portal `click`). */
export const STRONG_GRANT_METHODS: readonly ConsentGrantMethod[] = [
  'signed_form',
  'monetary_transaction',
  'video_call',
  'id_verification',
] as const

const TERM_MS = 180 * 24 * 60 * 60 * 1000
const ANNUAL_MS = 365 * 24 * 60 * 60 * 1000

/** The renewal clock per grant type. `null` = standing (no expiry). */
export const GRANT_RENEWAL_MS_BY_TYPE: Record<ConsentGrantType, number | null> = {
  program_participation: TERM_MS,
  platform_account: TERM_MS,
  public_publication: ANNUAL_MS,
  photo_video_likeness: ANNUAL_MS,
  emergency_medical_pickup: TERM_MS,
  verification_link_sharing: null,
  // mentor_dm expires at term end (design C.3): re-confirmed per cohort.
  mentor_dm: TERM_MS,
}

/**
 * Grant types whose capture REQUIRES a strong `signed_form` method with a non-null
 * evidence artifact — a click is refused at the service AND a DB-trigger backstop
 * (design C.3). Today only `mentor_dm`: the signed form is deliberate friction, a
 * load-bearing test of guardian engagement the program wants to learn BEFORE
 * enabling the channel, not after. (This is distinct from the under-13
 * public_publication floor, which is age-conditioned; mentor_dm is unconditional.)
 */
export const SIGNED_FORM_REQUIRED_GRANT_TYPES: readonly ConsentGrantType[] = ['mentor_dm'] as const

/**
 * The two grant types that CANNOT be revoked alone — revoking them ends
 * enrollment, so the per-grant revoke endpoint REFUSES them and routes to the
 * existing enrollment-revoke path (§5 detail table: "No — revoking ends
 * enrollment"). A value, not a literal.
 */
export const ENROLLMENT_REQUIRED_GRANT_TYPES: readonly ConsentGrantType[] = [
  'program_participation',
  'emergency_medical_pickup',
] as const

/**
 * The grant types the now-adult must RE-CONFIRM at the 18th-birthday transfer —
 * the ones that persist past majority (§5 Rule 4: publication, likeness,
 * verification-link). Guardian grants of these lapse at maturation and the adult
 * self-grants them anew.
 */
export const SELF_RECONFIRM_GRANT_TYPES: readonly ConsentGrantType[] = [
  'public_publication',
  'photo_video_likeness',
  'verification_link_sharing',
] as const

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
  /** Invite token lifetime in ms (14 days), evaluated at decision time. Legacy
   * fallback for any kind absent from inviteTtlMsByKind. */
  inviteTtlMs: number
  /** Per-kind invite token lifetimes (adult 72h, guardian/student ~7d). */
  inviteTtlMsByKind: Record<InviteKindTtl, number>
  /** The per-issuer invite rate-limit rolling window in ms. */
  inviteRateLimitWindowMs: number
  /** The max invites one issuer may mint within the window. */
  inviteRateLimitMax: number
  /** Password-reset token lifetime in ms (1 hour), evaluated at decision time. */
  passwordResetTtlMs: number
  /** §10 TOTP: RFC 6238 time-step seconds (30). */
  totpStepSeconds: number
  /** §10 TOTP: number of digits in a code (6). */
  totpDigits: number
  /** §10 TOTP: accepted +/- steps at verification (1). */
  totpWindowSteps: number
  /** §10 TOTP: one-time recovery codes minted at enrollment confirm (10). */
  totpBackupCodeCount: number
  /** §10: the pending-2FA login token lifetime in ms (5 min), decision-time. */
  twoFactorPendingTtlMs: number
  /** §10 TOTP: the rolling attempt-rate-limit window in ms (15 min). */
  totpRateLimitWindowMs: number
  /** §10 TOTP: max second-factor attempts within the window (5). */
  totpRateLimitMax: number
  /** §10 TOTP: the issuer label in the otpauth:// provisioning URI. */
  totpIssuer: string
  /** delivery_status stamped on a freshly issued invite (delivery deferred). */
  inviteInitialDeliveryStatus: InviteInitialDeliveryStatus
  /** relationship recorded on a guardian-accept guardianship edge. */
  guardianRelationshipDefault: GuardianRelationship
  /** the intended verification_method on a pending guardianship edge. */
  guardianVerificationMethod: GuardianVerificationMethod
  /** the guardian name-match predicate (Flow A step 6); a config-not-code tunable. */
  guardianNameMatch: (nameOnAccount: string, nameOnForm: string) => boolean
  /** §5 REVIEW GATE: when true, publishing additionally requires the specific grant. */
  consentGrantLedgerEnforced: boolean
  /** §6 REVIEW GATE: when true, an ineligible mentor loses student-facing access. */
  mentorEligibilityEnforced: boolean
  /** Part D GLOBAL flag: when true, mentor-student DM is live (default false = dark). */
  mentorDmEnabled: boolean
  /** C.4: the DEFAULT allowed-hours window open hour (local), used when a chapter has no override. */
  dmOpenHourDefault: number
  /** C.4: the DEFAULT allowed-hours window close hour (local, exclusive). */
  dmCloseHourDefault: number
  /** C.11: the DM retention interval from DOB (PLACEHOLDER, pending counsel; ~age 30). */
  dmRetentionMs: number
  /** C.6: the weekly-message threshold above which full review is infeasible (PLACEHOLDER). */
  dmFullReviewMaxWeeklyMessages: number
  /** C.8: the guardian-visibility suspension expiry in ms (90 days). */
  dmVisibilitySuspensionMs: number
  /** §5 Rule 3: the notify-and-object hold window in ms (default 5 days). */
  publicationHoldWindowMs: number
  /** §5: the renewal clock per grant type (null = standing). */
  grantRenewalMsByType: Record<ConsentGrantType, number | null>
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
  inviteTtlMsByKind: INVITE_TTL_MS_BY_KIND,
  inviteRateLimitWindowMs: INVITE_RATE_LIMIT_WINDOW_MS,
  inviteRateLimitMax: INVITE_RATE_LIMIT_MAX,
  passwordResetTtlMs: PASSWORD_RESET_TTL_MS,
  totpStepSeconds: TOTP_STEP_SECONDS,
  totpDigits: TOTP_DIGITS,
  totpWindowSteps: TOTP_WINDOW_STEPS,
  totpBackupCodeCount: TOTP_BACKUP_CODE_COUNT,
  twoFactorPendingTtlMs: TWO_FACTOR_PENDING_TTL_MS,
  totpRateLimitWindowMs: TOTP_RATE_LIMIT_WINDOW_MS,
  totpRateLimitMax: TOTP_RATE_LIMIT_MAX,
  totpIssuer: TOTP_ISSUER,
  inviteInitialDeliveryStatus: INVITE_INITIAL_DELIVERY_STATUS,
  guardianRelationshipDefault: GUARDIAN_RELATIONSHIP_DEFAULT,
  guardianVerificationMethod: GUARDIAN_VERIFICATION_METHOD,
  guardianNameMatch: guardianNamesMatch,
  consentGrantLedgerEnforced: CONSENT_GRANT_LEDGER_ENFORCED,
  mentorEligibilityEnforced: MENTOR_ELIGIBILITY_ENFORCED,
  mentorDmEnabled: MENTOR_DM_ENABLED,
  dmOpenHourDefault: DM_OPEN_HOUR_DEFAULT,
  dmCloseHourDefault: DM_CLOSE_HOUR_DEFAULT,
  dmRetentionMs: DM_RETENTION_MS,
  dmFullReviewMaxWeeklyMessages: DM_FULL_REVIEW_MAX_WEEKLY_MESSAGES,
  dmVisibilitySuspensionMs: DM_VISIBILITY_SUSPENSION_MS,
  publicationHoldWindowMs: PUBLICATION_HOLD_WINDOW_MS,
  grantRenewalMsByType: GRANT_RENEWAL_MS_BY_TYPE,
}
