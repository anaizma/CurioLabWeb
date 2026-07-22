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
