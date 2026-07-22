// -------------------------------------------------------------------------
// The AsyncLocalStorage authorization context and the repository-write
// backstop (03-authorization.md; 07-test-plan.md "The two invariant guards").
//
// `authorize` records its allow decision on a per-request store. The repository
// write layer calls assertAuthorized() before any mutation and throws if no
// decision is present on the current request — IN EVERY ENVIRONMENT, not only
// in tests. This is the runtime backstop that makes the single-code-path
// invariant hold even if a route forgets to call `authorize`.
// -------------------------------------------------------------------------

import { AsyncLocalStorage } from 'node:async_hooks'
import type { Capability } from '@curiolab/core'

/** The minimal record of an allow decision, enough to prove one was made. */
export interface AuthDecisionRecord {
  capability: Capability
  actorAccountId: string
  resourceId?: string | null
}

interface RequestStore {
  decisions: AuthDecisionRecord[]
}

const als = new AsyncLocalStorage<RequestStore>()

/** Establish a fresh authorization store for the duration of `fn`. */
export function withRequest<T>(fn: () => Promise<T>): Promise<T> {
  return als.run({ decisions: [] }, fn)
}

/** Record an allow decision on the current request. Throws if there is none. */
export function recordDecision(decision: AuthDecisionRecord): void {
  const store = als.getStore()
  if (store === undefined) {
    throw new Error('recordDecision called outside a request context (no withRequest on the stack)')
  }
  store.decisions.push(decision)
}

/** The allow decisions recorded so far on the current request (empty if none). */
export function currentDecisions(): readonly AuthDecisionRecord[] {
  return als.getStore()?.decisions ?? []
}

/**
 * The repository-write backstop. Called by the write layer before any mutation.
 * Throws unless an authorization decision has been recorded on this request.
 */
export function assertAuthorized(): void {
  const store = als.getStore()
  if (store === undefined || store.decisions.length === 0) {
    throw new Error(
      'repository write blocked: no authorization decision recorded on the current request',
    )
  }
}
