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
