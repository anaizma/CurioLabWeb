// -------------------------------------------------------------------------
// Error mapping. A thrown `Forbidden` maps to 403 with an OPAQUE body carrying
// no reason (05-api-surface.md: out_of_scope / role_not_permitted /
// subject_consent_missing must be indistinguishable from outside). Known
// service errors map to their HTTP status by class name; a genuinely unknown
// error is re-thrown so a real bug surfaces as a 500 rather than being masked.
// -------------------------------------------------------------------------

import { Forbidden } from '@curiolab/runtime'
import type { ControllerResult } from './types.js'

/** Raised by a controller for malformed / missing input (a 400, never a 500). */
export class ValidationError extends Error {
  constructor(message = 'invalid request') {
    super(message)
    this.name = 'ValidationError'
  }
}

/** The opaque 403 body — no DenyReason, no detail (must-not #21). */
export const FORBIDDEN_BODY = { error: 'forbidden' } as const

/**
 * Service errors that are a policy REFUSAL of the acting account itself (acting
 * on another account, or an age floor not met) -> 403 with the same opaque body
 * as a capability deny. These carry no registry capability (the maturation
 * self-actions are gated by self-ownership + an age floor, not `authorize`), so
 * they cannot surface as a `Forbidden`; they map here.
 */
const FORBIDDEN = new Set([
  'MaturationNotSelfError',
  'MaturationAgeError',
])

/** Service errors whose meaning is "the named resource does not exist" -> 404. */
const NOT_FOUND = new Set([
  'ApplicationNotFoundError',
  'LeadNotFoundError',
  'InviteNotFoundError',
  'GuardianshipNotFoundError',
  'MembershipNotFoundError',
  'DeletionRequestNotFoundError',
  'ExportRequestNotFoundError',
  'GuardianChildNotFoundError',
  'DobCorrectionSubjectNotFoundError',
  'ConsentEnrollmentNotFoundError',
  'DeletionSubjectChapterNotFoundError',
  // The Lab (M2.6)
  'PostNotFoundError',
  'CommentNotFoundError',
  'ModerationReportNotFoundError',
  'FeedAuthorMembershipNotFoundError',
  // Profile / projects / media / newsletter (M3.7)
  'ProjectNotFoundError',
  'NewsletterIssueNotFoundError',
  'MediaNotFoundError',
  'ProfileSubjectNotFoundError',
  'NarrativeNotFoundError',
  'VerificationSubjectNotFoundError',
  // Coming of age (M1 auth / account-lifecycle wiring)
  'MaturationAccountNotFoundError',
  'MaturationChapterNotFoundError',
  // Platform administration (org structure)
  'ChapterNotFoundError',
  'TermNotFoundError',
  'PodNotFoundError',
])

/** Illegal state-machine edges / phase conflicts -> 409. */
const CONFLICT = new Set([
  'IllegalTransitionError',
  'IllegalMembershipTransitionError',
  'IllegalDeletionTransitionError',
  'IllegalGuardianshipTransitionError',
  'Stage2AlreadyStartedError',
  'Stage2NotInPhaseError',
  // The Lab (M2.6): illegal feed-content / moderation-report lifecycle edges.
  'IllegalFeedContentTransitionError',
  'IllegalModerationTransitionError',
  // Profile / projects / newsletter lifecycle edges + policy refusals (M3.7).
  'IllegalProjectTransitionError',
  'IllegalNewsletterTransitionError',
  'IllegalNarrativeTransitionError',
  'NewsletterPublishConsentChangedError',
  // A reviewer is authorized but the media cannot yet be cleared (policy refusal).
  'MediaNotClearableError',
  // Coming of age: an illegal maturation edge, and recovery against a live membership.
  'IllegalMaturationTransitionError',
  'ReissueActiveMembershipError',
])

/** Opaque, single-signal token failures -> 401 (reveals nothing; 05-api-surface). */
const INVALID_TOKEN = new Set([
  'InvalidStage2TokenError',
  'InvalidInviteError',
  // The newsletter confirm/unsubscribe token surface reveals nothing (M3.6).
  'InvalidSubscriberTokenError',
  // The password-reset / account-recovery consume token surface reveals nothing.
  'InvalidCredentialTokenError',
])

/** Known input / precondition violations -> 400. */
const BAD_REQUEST = new Set([
  'ValidationError',
  'EnrollmentDobRequiredError',
  'StudentSectionIdentifyingFieldError',
  'StudentSectionFieldNotAllowedError',
  'Stage2ParentFactsIncompleteError',
  'Stage2LeadChapterRequiredError',
  'InviteCredentialMismatchError',
  'GuardianInviteEmailMismatchError',
  'ConsentNotDigitallyGrantableError',
  'ConsentScopeRefRequiredError',
  'MembershipActivationConsentError',
  'MembershipActivationEvidenceError',
  'DeletionReasonRequiredError',
  // The Lab (M2.6): the member create path rejects a milestone / system post.
  'PostMilestoneForbiddenError',
  // The 16+ self_private witness preconditions (missing / invalid / is-a-guardian).
  'CredentialWitnessRequiredError',
  'CredentialWitnessInvalidError',
  'CredentialWitnessIsGuardianError',
])

/**
 * Map a thrown error to a ControllerResult, or `null` when it is not a known
 * error (the caller re-throws so it surfaces as a 500). The body for a
 * Forbidden is opaque; other bodies carry a machine code but never a
 * DenyReason.
 */
export function mapError(e: unknown): ControllerResult | null {
  if (e instanceof Forbidden) return { status: 403, body: FORBIDDEN_BODY }
  const name = e instanceof Error ? e.name : ''
  if (FORBIDDEN.has(name)) return { status: 403, body: FORBIDDEN_BODY }
  if (INVALID_TOKEN.has(name)) return { status: 401, body: { error: 'invalid_token' } }
  if (NOT_FOUND.has(name)) return { status: 404, body: { error: 'not_found' } }
  if (CONFLICT.has(name)) return { status: 409, body: { error: 'conflict' } }
  if (BAD_REQUEST.has(name)) return { status: 400, body: { error: 'invalid_request' } }
  return null
}

/** A required non-empty string, or a ValidationError (mapped to 400). */
export function reqStr(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.trim().length === 0) {
    throw new ValidationError(`missing or invalid field: ${field}`)
  }
  return v
}

/** An optional string field (null when absent). */
export function optStr(v: unknown): string | null {
  return v == null ? null : String(v)
}

/**
 * Parse a Web Request JSON body into a plain record, tolerating an empty/absent
 * body (returns {}). Used by the thin Next adapters so a malformed body is a
 * benign empty object the controller then validates, never a thrown 500.
 */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await req.json()
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    /* fall through to the empty object */
  }
  return {}
}

/** A required plain object, or a ValidationError. */
export function reqObj(v: unknown, field: string): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw new ValidationError(`missing or invalid field: ${field}`)
  }
  return v as Record<string, unknown>
}
