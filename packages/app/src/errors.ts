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
