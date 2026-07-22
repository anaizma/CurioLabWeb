// -------------------------------------------------------------------------
// § 312.7 enforcement — participation must never require public visibility
// (compliance-coppa.md 1.4 and Part 3 item 6). "A student who never goes public
// must be able to complete every tier."
//
// The invariant, made inspectable: NO capability whose result is required for
// tier progression may list `public_profile` in its `actorConsent`. This module
// declares the tier-progression capability set as DATA and provides a pure check
// over the registry that the § 312.7 meta-test asserts. If someone adds
// `public_profile` to a tier-progression capability's `actorConsent`, the check
// flips to `true` and the meta-test fails.
// -------------------------------------------------------------------------

import {
  REGISTRY,
  type AuthContext,
  type Capability,
  type CapabilityDef,
  type ConsentType,
  type Resource,
} from '@curiolab/core'

/**
 * The capabilities a student must successfully exercise for their work to count
 * toward tier progression (explorer -> builder -> innovator): building and
 * submitting project evidence, its verification (the `tier_transition`
 * `evidence_ref`), and the participation that produces it. Inspectable as data.
 *
 * None of these may gate on public visibility — that is the § 312.7 rule this
 * set exists to check.
 */
export const TIER_PROGRESSION_CAPABILITIES: readonly Capability[] = [
  'feed.post',
  'feed.comment',
  'project.create',
  'project.submit',
  'project.verify',
] as const

/** A minimal, valid AuthContext at `age`, used only to probe `actorConsent`. */
function probeCtx(age: number): AuthContext {
  return {
    now: 0,
    account: {
      id: 'probe',
      status: 'active',
      age,
      maturation_state: age < 18 ? 'minor' : 'self_managed',
      credential_owner: 'guardian_provisioned',
    },
    session: { mode: 'full', expires_at: 1, revoked_at: null },
    memberships: [],
    guardianOf: [],
    consentsByChild: new Map(),
  }
}

// Probe both sides of any age-conditioned `actorConsent` (e.g. the minor-only
// `platform_participation` requirement) so no branch escapes the check.
const PROBE_CONTEXTS: readonly AuthContext[] = [probeCtx(15), probeCtx(30)]
const PROBE_RESOURCE: Resource = {}

type ActorConsentOnly = Pick<CapabilityDef, 'actorConsent'>

/**
 * Whether ANY capability in `caps` requires `public_profile` of the actor, per
 * the given registry. Evaluates each capability's `actorConsent` across
 * representative actors, so an age-conditioned requirement cannot slip through.
 *
 * Defaults to the real REGISTRY and TIER_PROGRESSION_CAPABILITIES; both are
 * injectable so the check itself is testable (a poisoned registry returns true).
 */
export function publicProfileGatesAnyTierProgression(
  registry: Partial<Record<Capability, ActorConsentOnly>> = REGISTRY,
  caps: readonly Capability[] = TIER_PROGRESSION_CAPABILITIES,
): boolean {
  for (const cap of caps) {
    const fn = registry[cap]?.actorConsent
    if (fn === undefined) continue
    for (const ctx of PROBE_CONTEXTS) {
      const required: ConsentType[] = fn(ctx, PROBE_RESOURCE)
      if (required.includes('public_profile')) return true
    }
  }
  return false
}
