import type { AuthContext, Membership, Role } from '@curiolab/core'

/** A fully-formed, active AuthContext for an adult actor at `now`. */
export function baseCtx(actorId: string, now: Date, memberships: Membership[] = []): AuthContext {
  return {
    now: now.getTime(),
    account: {
      id: actorId,
      status: 'active',
      age: 40,
      maturation_state: 'self_managed',
      credential_owner: 'self_private',
    },
    session: { mode: 'full', expires_at: now.getTime() + 3_600_000, revoked_at: null },
    memberships,
    guardianOf: [],
    consentsByChild: new Map(),
  }
}

/** An in-force chapter membership with the given role in the given chapter. */
export function mem(role: Role, chapterId: string): Membership {
  return {
    chapter_id: chapterId,
    role,
    status: 'active',
    pod_id: null,
    tier: null,
    active_from: null,
    active_until: null,
  }
}
