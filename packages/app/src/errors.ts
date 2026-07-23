import type { TransitionResult } from '@curiolab/core'

/**
 * A requested application transition is not a legal edge of the application
 * lifecycle (04-state-machines). Carries the structured reason from
 * `canTransition` so a route can map it to a 409, distinct from a Forbidden
 * (which is an authorization failure and leaks no reason to the client).
 */
export class IllegalTransitionError extends Error {
  readonly from: string | null
  readonly to: string
  readonly reason: TransitionResult['reason']
  constructor(from: string | null, to: string, reason: TransitionResult['reason']) {
    super(`illegal application transition ${from ?? '(none)'} -> ${to}${reason ? ` (${reason})` : ''}`)
    this.name = 'IllegalTransitionError'
    this.from = from
    this.to = to
    this.reason = reason
  }
}

/** The referenced application does not exist. */
export class ApplicationNotFoundError extends Error {
  readonly applicationId: string
  constructor(applicationId: string) {
    super(`application not found: ${applicationId}`)
    this.name = 'ApplicationNotFoundError'
    this.applicationId = applicationId
  }
}

/**
 * A SEEDING enrollment (a brand-new student with no account yet) was created
 * without the form's date of birth. The DOB must live on the seeding enrollment
 * record until the account is created at accept-student (02-data-model.md
 * "enrollment_record"; decision-log.md "DOB on the enrollment record, reversed
 * and refined"); the database CHECK enforces the same, this is the service-layer
 * pre-check that fails cleanly before any storage upload.
 */
export class EnrollmentDobRequiredError extends Error {
  constructor() {
    super('a seeding enrollment (no student account yet) requires the form date of birth')
    this.name = 'EnrollmentDobRequiredError'
  }
}

/** The referenced application_lead does not exist (startStage2 of an unknown id). */
export class LeadNotFoundError extends Error {
  readonly leadId: string
  constructor(leadId: string) {
    super(`lead not found: ${leadId}`)
    this.name = 'LeadNotFoundError'
    this.leadId = leadId
  }
}

/**
 * startStage2 was called on a lead that is not `new` — Stage 2 has already been
 * started (a draft + parent token exist) or the lead has converted/been deleted.
 * Stage 2 starts exactly once per lead; a re-start would mint a second draft.
 */
export class Stage2AlreadyStartedError extends Error {
  readonly leadId: string
  constructor(leadId: string) {
    super(`Stage 2 already started for lead: ${leadId}`)
    this.name = 'Stage2AlreadyStartedError'
    this.leadId = leadId
  }
}

/**
 * A Stage 2 token-gated call presented a token that is not usable for the
 * requested op — never issued, forged, or the WRONG KIND (a student token at a
 * parent-only endpoint such as submitStage2). Deliberately ONE opaque error for
 * every not-usable cause, mirroring InvalidInviteError: the token surface reveals
 * nothing, so "wrong token" and "wrong role of token" look identical. This is
 * what makes "only the parent submits" hold — a student token simply fails to
 * resolve a parent-gated draft (milestone-1-application-funnel.md v2 invariant 4).
 */
export class InvalidStage2TokenError extends Error {
  constructor() {
    super('Stage 2 token is not usable')
    this.name = 'InvalidStage2TokenError'
  }
}

/**
 * A Stage 2 token-gated op was attempted against a lead whose 30-day window has
 * closed (`application_lead.expires_at < now`). The token itself resolves — this
 * is NOT a forged/wrong-kind token (that is InvalidStage2TokenError) — it is a
 * once-valid link the parent let lapse. Expiry is evaluated at REQUEST time
 * against `now` (design §8: "30-day expiry evaluated at request time"),
 * consistent with the rest of the codebase's decision-time expiry pattern
 * (sessions, invites, the unconverted-lead retention sweep). Carries the leadId
 * internally, like Stage2AlreadyStartedError; a route maps it to a 410/409.
 */
export class Stage2LeadExpiredError extends Error {
  readonly leadId: string
  constructor(leadId: string) {
    super(`Stage 2 lead has expired: ${leadId}`)
    this.name = 'Stage2LeadExpiredError'
    this.leadId = leadId
  }
}

/**
 * A Stage 2 op was attempted while the draft was in the wrong phase (e.g. submit
 * before the student has finished 2B, or a student re-save after submission).
 * Carries the expected and actual phase so a route can map it to a 409.
 */
export class Stage2NotInPhaseError extends Error {
  readonly expected: readonly string[]
  readonly actual: string
  constructor(expected: readonly string[], actual: string) {
    super(`Stage 2 draft is in phase ${actual}; expected one of ${expected.join(', ')}`)
    this.name = 'Stage2NotInPhaseError'
    this.expected = expected
    this.actual = actual
  }
}

/**
 * A 2B (student section) save carried an IDENTIFYING key (name/email/school/…).
 * 2B collects no identifying fields at all (milestone-1-application-funnel.md v2
 * invariant 3); the identifying key is REJECTED, not silently stripped, so a
 * tampered form fails loudly. The specific "identifying" error is distinct from
 * the generic "not on the allowlist" one below.
 */
export class StudentSectionIdentifyingFieldError extends Error {
  readonly field: string
  constructor(field: string) {
    super(`the 2B student section cannot carry the identifying field: ${field}`)
    this.name = 'StudentSectionIdentifyingFieldError'
    this.field = field
  }
}

/**
 * A 2B (student section) save carried a key that is not on the non-identifying
 * allowlist (config.ts stage2StudentAllowedFields). Rejected, not stripped, so
 * tampering fails loudly (milestone-1-application-funnel.md v2 invariant 3).
 */
export class StudentSectionFieldNotAllowedError extends Error {
  readonly field: string
  constructor(field: string) {
    super(`the 2B student section field is not on the allowlist: ${field}`)
    this.name = 'StudentSectionFieldNotAllowedError'
    this.field = field
  }
}

/**
 * submitStage2 could not build the `application` because the parent-provided 2A
 * facts are incomplete (a child name, guardian name, and guardian email are
 * required — the application's NOT-NULL applicant/guardian columns). The parent
 * must complete 2A before submitting at 2C.
 */
export class Stage2ParentFactsIncompleteError extends Error {
  readonly missing: readonly string[]
  constructor(missing: readonly string[]) {
    super(`the 2A parent section is missing required facts: ${missing.join(', ')}`)
    this.name = 'Stage2ParentFactsIncompleteError'
    this.missing = missing
  }
}

/**
 * submitStage2 could not build the `application` because the lead carries no
 * chapter (`application.chapter_id` is NOT NULL). A Stage-2 lead is invited into
 * a chapter, so this guards a misuse (a chapter-less lead reaching 2C submit).
 */
export class Stage2LeadChapterRequiredError extends Error {
  readonly leadId: string
  constructor(leadId: string) {
    super(`cannot mint an application: lead ${leadId} has no chapter`)
    this.name = 'Stage2LeadChapterRequiredError'
    this.leadId = leadId
  }
}

/** The referenced invite does not exist (ops resend of an unknown id). */
export class InviteNotFoundError extends Error {
  readonly inviteId: string
  constructor(inviteId: string) {
    super(`invite not found: ${inviteId}`)
    this.name = 'InviteNotFoundError'
    this.inviteId = inviteId
  }
}

/**
 * An accept was attempted against a token that is not usable — never issued,
 * expired, revoked (superseded), or already accepted. Deliberately ONE opaque
 * error for every not-usable cause: acceptance must not distinguish "wrong
 * token" from "expired" from "already used" (05-api-surface: the accept
 * endpoints "reveal nothing", the same not-usable signal as a forged link).
 */
export class InvalidInviteError extends Error {
  constructor() {
    super('invite is not usable')
    this.name = 'InvalidInviteError'
  }
}

/**
 * The submitted credential shape does not match the invite kind: a guardian /
 * mentor / staff invite takes email + password; a student invite takes username
 * + password (06-onboarding-flows Flow B: guardian-mediated, a username and no
 * email — respecting the `email XOR username` account constraint).
 */
export class InviteCredentialMismatchError extends Error {
  constructor(kind: string, expected: 'email' | 'username') {
    super(`a ${kind} invite requires ${expected} credentials`)
    this.name = 'InviteCredentialMismatchError'
  }
}

/**
 * A guardian invite's `target_email` must equal the guardian email on the bound
 * enrollment record (02-data-model; enforced at the DB by the
 * invite_guardian_email trigger, which is the floor — this is the service-layer
 * pre-check). Changing the email requires a new signed form.
 */
export class GuardianInviteEmailMismatchError extends Error {
  constructor() {
    super('guardian invite target_email must equal the bound enrollment guardian email')
    this.name = 'GuardianInviteEmailMismatchError'
  }
}

/**
 * A `dob.correct` names an account with no enrollment record, so the enrolling
 * chapter cannot be resolved and the correction cannot be scoped or authorized.
 * A student always has a seeding enrollment record; this guards a misuse.
 */
export class DobCorrectionSubjectNotFoundError extends Error {
  readonly accountId: string
  constructor(accountId: string) {
    super(`no enrollment record found to scope a DOB correction for account: ${accountId}`)
    this.name = 'DobCorrectionSubjectNotFoundError'
    this.accountId = accountId
  }
}

/** The referenced guardianship edge does not exist (verify of an unknown id). */
export class GuardianshipNotFoundError extends Error {
  readonly guardianshipId: string
  constructor(guardianshipId: string) {
    super(`guardianship not found: ${guardianshipId}`)
    this.name = 'GuardianshipNotFoundError'
    this.guardianshipId = guardianshipId
  }
}

/**
 * A digital consent grant named a type captured only on the signed form
 * (Block A: `enrollment`, `data_collection`; compliance-coppa.md Part 2 Stage 2).
 * Those are written form-sourced by the enrollment upload (coupling D), never by
 * the digital grant flow. Which types are digitally grantable is config-driven
 * (see consent-blocks.ts).
 */
export class ConsentNotDigitallyGrantableError extends Error {
  readonly consentType: string
  constructor(consentType: string) {
    super(`consent type is form-sourced, not digitally grantable: ${consentType}`)
    this.name = 'ConsentNotDigitallyGrantableError'
    this.consentType = consentType
  }
}

/**
 * A digital grant of a scoped consent type (`external_publication`) omitted its
 * required `scope_ref`. That consent is per-item, never blanket
 * (compliance-coppa.md Part 2 Stage 2; enforced at the DB by
 * `consent_external_pub_scope_ref`). This is the service-layer pre-check that
 * fails cleanly before the transaction rather than as a DB check violation.
 */
export class ConsentScopeRefRequiredError extends Error {
  readonly consentType: string
  constructor(consentType: string) {
    super(`consent type requires a scope_ref: ${consentType}`)
    this.name = 'ConsentScopeRefRequiredError'
    this.consentType = consentType
  }
}

/**
 * A digital consent grant/revoke could not resolve the student's enrollment
 * anchor (`enrollment_record_id`) — either the student account or any enrollment
 * record for it is absent. A digital consent decision is anchored to the
 * enrollment it concerns (02-data-model consent `enrollment_record_id`, the
 * temporal anchor), so with no enrollment there is nothing to anchor to.
 */
export class ConsentEnrollmentNotFoundError extends Error {
  readonly studentAccountId: string
  constructor(studentAccountId: string) {
    super(`no enrollment record found for student: ${studentAccountId}`)
    this.name = 'ConsentEnrollmentNotFoundError'
    this.studentAccountId = studentAccountId
  }
}

/**
 * A guardian-portal read/request named a child account that does not exist, so
 * the subject's age (the guardian-scope age bound) cannot be resolved. Mirrors
 * ConsentService.loadAnchor: the subject facts are loaded before `authorize`
 * (which needs the subject age), so an unknown subject is a typed not-found, not
 * a Forbidden. A guardian's verified child always exists; this guards a misuse.
 */
export class GuardianChildNotFoundError extends Error {
  readonly childAccountId: string
  constructor(childAccountId: string) {
    super(`no child account found: ${childAccountId}`)
    this.name = 'GuardianChildNotFoundError'
    this.childAccountId = childAccountId
  }
}

/** The referenced membership does not exist (activation of an unknown id). */
export class MembershipNotFoundError extends Error {
  readonly membershipId: string
  constructor(membershipId: string) {
    super(`membership not found: ${membershipId}`)
    this.name = 'MembershipNotFoundError'
    this.membershipId = membershipId
  }
}

/**
 * Student activation was attempted without an active `enrollment` consent
 * (04-state-machines membership `pending -> active`: "requires active
 * `enrollment` consent for a student"; 06-onboarding-flows Flow B step 3). The
 * form-sourced `enrollment` consent is the ratification of the signed paper form;
 * a student cannot be activated until it is active.
 */
export class MembershipActivationConsentError extends Error {
  readonly membershipId: string
  constructor(membershipId: string) {
    super(`student activation requires an active enrollment consent (membership ${membershipId})`)
    this.name = 'MembershipActivationConsentError'
    this.membershipId = membershipId
  }
}

/**
 * A student activation could not resolve the enrollment record that is the
 * initial tier_transition's `evidence_ref` (admission is the entry evidence for
 * the Explorer grant; tier_transition.evidence_ref is NOT NULL). A properly
 * seeded student always has a linked enrollment record; this guards a misuse.
 */
export class MembershipActivationEvidenceError extends Error {
  readonly membershipId: string
  constructor(membershipId: string) {
    super(`no enrollment record to evidence the initial tier grant (membership ${membershipId})`)
    this.name = 'MembershipActivationEvidenceError'
    this.membershipId = membershipId
  }
}

/**
 * The requested membership state change is not a legal edge of the membership
 * lifecycle (04-state-machines). Activation only ever fires on a `pending`
 * membership (and its `pending` account); anything else is rejected. Carries the
 * structured reason from `canTransition` so a route can map it to a 409, distinct
 * from a Forbidden (an authorization failure that leaks no reason).
 */
export class IllegalMembershipTransitionError extends Error {
  readonly from: string | null
  readonly to: string
  readonly reason: TransitionResult['reason']
  constructor(from: string | null, to: string, reason: TransitionResult['reason']) {
    super(`illegal membership transition ${from ?? '(none)'} -> ${to}${reason ? ` (${reason})` : ''}`)
    this.name = 'IllegalMembershipTransitionError'
    this.from = from
    this.to = to
    this.reason = reason
  }
}

/** The referenced deletion_request does not exist (review/fulfill of an unknown id). */
export class DeletionRequestNotFoundError extends Error {
  readonly deletionRequestId: string
  constructor(deletionRequestId: string) {
    super(`deletion request not found: ${deletionRequestId}`)
    this.name = 'DeletionRequestNotFoundError'
    this.deletionRequestId = deletionRequestId
  }
}

/** The referenced export_request does not exist (fulfill of an unknown id). */
export class ExportRequestNotFoundError extends Error {
  readonly exportRequestId: string
  constructor(exportRequestId: string) {
    super(`export request not found: ${exportRequestId}`)
    this.name = 'ExportRequestNotFoundError'
    this.exportRequestId = exportRequestId
  }
}

/**
 * A deletion/export decision names a subject account with no enrollment record,
 * so the enrolling chapter cannot be resolved and the decision cannot be scoped
 * or authorized. A student always has a seeding enrollment record; this guards a
 * misuse (mirrors DobCorrectionSubjectNotFoundError).
 */
export class DeletionSubjectChapterNotFoundError extends Error {
  readonly subjectAccountId: string
  constructor(subjectAccountId: string) {
    super(`no enrollment record found to scope a deletion/export for account: ${subjectAccountId}`)
    this.name = 'DeletionSubjectChapterNotFoundError'
    this.subjectAccountId = subjectAccountId
  }
}

/**
 * The requested deletion_request state change is not a legal edge of the
 * deletion lifecycle (04-state-machines): fulfillment (`fulfilled_full`,
 * `fulfilled_redaction`, `partially_fulfilled`, `refused`) is only ever reached
 * from `under_review`, so a request that was never reviewed (still `requested`)
 * or already decided cannot be fulfilled. Carries the structured reason from
 * `canTransition` so a route can map it to a 409, distinct from a Forbidden.
 */
export class IllegalDeletionTransitionError extends Error {
  readonly from: string | null
  readonly to: string
  readonly reason: TransitionResult['reason']
  constructor(from: string | null, to: string, reason: TransitionResult['reason']) {
    super(`illegal deletion transition ${from ?? '(none)'} -> ${to}${reason ? ` (${reason})` : ''}`)
    this.name = 'IllegalDeletionTransitionError'
    this.from = from
    this.to = to
    this.reason = reason
  }
}

/**
 * A `partial` (partially_fulfilled) deletion outcome was applied without a
 * documented `decision_reason`. Unlike `refused` (whose reason is a DB CHECK,
 * migration 0008), a partial fulfillment has no database check, so the service
 * enforces the "a partial fulfillment carries a documented reason" rule
 * (04-state-machines deletion_request; compliance-coppa.md Part 3).
 */
export class DeletionReasonRequiredError extends Error {
  readonly decision: string
  constructor(decision: string) {
    super(`a ${decision} deletion outcome requires a documented decision_reason`)
    this.name = 'DeletionReasonRequiredError'
    this.decision = decision
  }
}

// ---------------------------------------------------------------------------
// Feed (Milestone 2.2: The Lab — posts, comments, reactions).
// ---------------------------------------------------------------------------

/** The referenced post does not exist (edit/moderate/react of an unknown id). */
export class PostNotFoundError extends Error {
  readonly postId: string
  constructor(postId: string) {
    super(`post not found: ${postId}`)
    this.name = 'PostNotFoundError'
    this.postId = postId
  }
}

/** The referenced comment does not exist (moderate/react of an unknown id). */
export class CommentNotFoundError extends Error {
  readonly commentId: string
  constructor(commentId: string) {
    super(`comment not found: ${commentId}`)
    this.name = 'CommentNotFoundError'
    this.commentId = commentId
  }
}

/**
 * A `PostService.create` attempted to mint a `milestone` post or a
 * `system_generated` one. Milestone posts are the SYSTEM path only (M2.5,
 * driven by lifecycle transitions writing a timeline_entry + a system_generated
 * milestone post); the member-authored create path never produces one
 * (milestone-2.md §M2.2; 04-state-machines "milestone posts are
 * system_generated and skip the consent gate"). Rejected before any IO.
 */
export class PostMilestoneForbiddenError extends Error {
  readonly kind: 'milestone_type' | 'system_generated'
  constructor(kind: 'milestone_type' | 'system_generated') {
    super(
      kind === 'milestone_type'
        ? 'a milestone post is system-generated only; it cannot be created via PostService.create'
        : 'a system_generated post cannot be created via PostService.create',
    )
    this.name = 'PostMilestoneForbiddenError'
    this.kind = kind
  }
}

/**
 * A requested post/comment lifecycle change is not a legal edge of the feed
 * content machine (04-state-machines `published -> hidden -> removed`; `removed`
 * is terminal). Carries the structured reason from `canTransition` so a route
 * can map it to a 409, distinct from a Forbidden (an authorization failure that
 * leaks no reason). `machine` distinguishes the post and comment lifecycles
 * (identical shape, separate entities).
 */
export class IllegalFeedContentTransitionError extends Error {
  readonly machine: 'feed_post' | 'comment'
  readonly from: string | null
  readonly to: string
  readonly reason: TransitionResult['reason']
  constructor(
    machine: 'feed_post' | 'comment',
    from: string | null,
    to: string,
    reason: TransitionResult['reason'],
  ) {
    super(`illegal ${machine} transition ${from ?? '(none)'} -> ${to}${reason ? ` (${reason})` : ''}`)
    this.name = 'IllegalFeedContentTransitionError'
    this.machine = machine
    this.from = from
    this.to = to
    this.reason = reason
  }
}

/**
 * A feed write authorized for the actor could not resolve the actor's in-scope
 * active membership row (the post/comment `author_membership_id`, or the
 * reaction `membership_id`). Authorship is by membership so the row carries the
 * author's capacity and scope (02-data-model). `can` matched an in-force
 * membership in the actor's AuthContext, so a missing DB row here is a data
 * mismatch, not a normal denial.
 */
export class FeedAuthorMembershipNotFoundError extends Error {
  readonly accountId: string
  readonly chapterId: string
  constructor(accountId: string, chapterId: string) {
    super(`no active membership for account ${accountId} in chapter ${chapterId} to author a feed write`)
    this.name = 'FeedAuthorMembershipNotFoundError'
    this.accountId = accountId
    this.chapterId = chapterId
  }
}

// ---------------------------------------------------------------------------
// Moderation (Milestone 2.4: The Lab — the report queue).
// ---------------------------------------------------------------------------

/** The referenced moderation_report does not exist (ack/resolve/escalate of an unknown id). */
export class ModerationReportNotFoundError extends Error {
  readonly reportId: string
  constructor(reportId: string) {
    super(`moderation report not found: ${reportId}`)
    this.name = 'ModerationReportNotFoundError'
    this.reportId = reportId
  }
}

/**
 * A requested moderation_report lifecycle change is not a legal edge of the
 * moderation machine (04-state-machines: `filed -> acknowledged -> resolved`;
 * `escalated` reachable from any pre-resolution state; `resolved` terminal). For
 * example, resolving a still-`filed` (never acknowledged) report, or acting on an
 * already-`resolved` one. Carries the structured reason from `canTransition` so a
 * route can map it to a 409, distinct from a Forbidden (an authorization failure
 * that leaks no reason). The report has no status column — the state is derived
 * from its lifecycle timestamps.
 */
export class IllegalModerationTransitionError extends Error {
  readonly from: string | null
  readonly to: string
  readonly reason: TransitionResult['reason']
  constructor(from: string | null, to: string, reason: TransitionResult['reason']) {
    super(`illegal moderation_report transition ${from ?? '(none)'} -> ${to}${reason ? ` (${reason})` : ''}`)
    this.name = 'IllegalModerationTransitionError'
    this.from = from
    this.to = to
    this.reason = reason
  }
}

/**
 * The requested guardianship state change is not a legal edge of the
 * guardianship lifecycle (04-state-machines). Verification only ever fires on a
 * `pending` edge; an already `verified`, `rejected`, `revoked`, or `lapsed` edge
 * is not verifiable. Carries the structured reason from `canTransition` so a
 * route can map it to a 409, distinct from a Forbidden (an authorization failure
 * that leaks no reason).
 */
export class IllegalGuardianshipTransitionError extends Error {
  readonly from: string | null
  readonly to: string
  readonly reason: TransitionResult['reason']
  constructor(from: string | null, to: string, reason: TransitionResult['reason']) {
    super(`illegal guardianship transition ${from ?? '(none)'} -> ${to}${reason ? ` (${reason})` : ''}`)
    this.name = 'IllegalGuardianshipTransitionError'
    this.from = from
    this.to = to
    this.reason = reason
  }
}
