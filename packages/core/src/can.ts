import { platformGrant } from './platformGrant.js'
import { REGISTRY } from './registry.js'
import { MENTOR_ELIGIBILITY_ROLES, STUDENT_FACING_CAPABILITIES } from './mentor-eligibility.js'
import type {
  AuthContext,
  Capability,
  ConsentState,
  ConsentType,
  Decision,
  DenyReason,
  Membership,
  Obligation,
  Resource,
  Scope,
  StudentId,
} from './types.js'

function deny(reason: DenyReason, detail: Record<string, unknown> = {}): Decision {
  return { allowed: false, reason, detail }
}

/** A membership is in force iff active AND active_from <= now < active_until. */
function inForce(m: Membership, now: number): boolean {
  if (m.status !== 'active') return false
  if (m.active_from !== null && m.active_from > now) return false
  if (m.active_until !== null && now >= m.active_until) return false
  return true
}

/**
 * Among the actor's in-force memberships matching a predicate, prefer one whose
 * role is permitted by the capability, so a permitted membership is not masked
 * by an unrelated one (must-not #1). Falls back to any match so an unpermitted
 * match still yields role_not_permitted rather than out_of_scope.
 */
function pickMembership(
  ctx: AuthContext,
  roles: readonly Membership['role'][],
  match: (m: Membership) => boolean,
): Membership | null {
  let fallback: Membership | null = null
  for (const m of ctx.memberships) {
    if (!inForce(m, ctx.now) || !match(m)) continue
    if (roles.includes(m.role)) return m
    if (fallback === null) fallback = m
  }
  return fallback
}

/**
 * §6 REVIEW GATE (flag-guarded). A membership passes the eligibility gate for
 * this capability UNLESS: enforcement is on, the capability is student-facing, the
 * membership's role is a mentor/teaching role, and the membership is explicitly
 * marked ineligible. In that one case it does NOT confer the capability — it is
 * skipped during scope matching, so a pure mentor denies opaque `out_of_scope`
 * (no leak of why). With enforcement off (the default), this always returns true,
 * so a mentor's access is exactly as today. Only `mentorEligible === false`
 * blocks; an unhydrated/undefined value never restricts.
 */
function eligibilityOk(ctx: AuthContext, capability: Capability, m: Membership): boolean {
  if (ctx.enforceMentorEligibility !== true) return true
  if (!STUDENT_FACING_CAPABILITIES.has(capability)) return true
  if (!MENTOR_ELIGIBILITY_ROLES.includes(m.role)) return true
  return m.mentorEligible !== false
}

/** The subject consent snapshot travels on the resource; undefined = unknown. */
function consentSnapshotFor(
  resource: Resource,
  student: StudentId,
  type: ConsentType,
): ConsentState | undefined {
  const item = resource.studentAuthoredItems?.find((i) => i.student === student)
  return item?.consent?.[type]
}

type Match =
  | { via: 'platform' }
  | { via: 'guardian' }
  // Self-ownership of one's OWN account, independent of any chapter membership —
  // an `own`-scoped capability declared with an EMPTY role set (account.self.*).
  // The account owner is the authority over their own row, so a membership-less
  // self-actor (a guardian on their own account) matches. Mirrors the `guardian`
  // shape: no membership, the role gate is skipped.
  | { via: 'own_self' }
  | { via: Exclude<Scope, 'platform' | 'guardian'>; membership: Membership }

/**
 * can(ctx, capability, resource) — the pure authorization decision.
 *
 * No IO, no imports outside the core package, deterministic given its inputs.
 * Never logs, never throws. The seven-step resolution order is verbatim from
 * 03-authorization.md.
 */
export function can(
  ctx: AuthContext,
  capability: Capability,
  resource: Resource,
): Decision {
  const def = REGISTRY[capability]
  if (def === undefined) return deny('out_of_scope', { unknownCapability: capability })

  // 1. Account gate
  if (ctx.account.status !== 'active') {
    return deny('account_not_active', { status: ctx.account.status })
  }

  // 2. Session and impersonation gate (decision-time expiry against ctx.now)
  const s = ctx.session
  if (s.revoked_at !== null && s.revoked_at <= ctx.now) {
    return deny('session_invalid', { cause: 'revoked' })
  }
  if (s.expires_at <= ctx.now) {
    return deny('session_invalid', { cause: 'expired' })
  }
  if (s.impersonation !== undefined && s.mode === 'read_only' && def.writes) {
    return deny('impersonation_write_forbidden', {})
  }

  // 3. Scope resolution (platformGrant may satisfy this)
  const pg = platformGrant(ctx, capability, resource)
  const scopes: Scope[] = Array.isArray(def.scope) ? def.scope : [def.scope]
  let match: Match | null = null

  if (pg?.scope) {
    match = { via: 'platform' }
  } else {
    for (const scope of scopes) {
      if (scope === 'chapter') {
        const m = pickMembership(
          ctx,
          def.roles,
          (mm) => mm.chapter_id === resource.chapter_id && eligibilityOk(ctx, capability, mm),
        )
        if (m) {
          match = { via: 'chapter', membership: m }
          break
        }
      } else if (scope === 'pod') {
        const m = pickMembership(
          ctx,
          def.roles,
          (mm) =>
            mm.pod_id !== null &&
            mm.pod_id === resource.pod_id &&
            eligibilityOk(ctx, capability, mm),
        )
        if (m) {
          match = { via: 'pod', membership: m }
          break
        }
      } else if (scope === 'own') {
        const owns = resource.ownerAccountId != null && resource.ownerAccountId === ctx.account.id
        if (owns && (def.ownCondition?.(ctx) ?? true)) {
          // An empty role set means self-ownership itself is the authority (the
          // account.self.* "My Information" surface): the owner may act on their own
          // account with NO chapter membership required — so a membership-less
          // guardian matches, and the role gate is skipped (like `guardian`). No
          // existing capability declares own-scope with roles [], so this is inert
          // for every prior capability (a non-empty role set still requires a
          // membership whose role is permitted).
          if (def.roles.length === 0) {
            match = { via: 'own_self' }
            break
          }
          const m = pickMembership(ctx, def.roles, () => true)
          if (m) {
            match = { via: 'own', membership: m }
            break
          }
        }
      } else if (scope === 'guardian') {
        const subject = resource.subjectAccountId
        // Guardian authority is over the guardian's own verified child (the edge
        // is in `guardianOf`; a lapsed/revoked edge is already absent). The age-18
        // bar applies only to guardian WRITE authority (consent grant/revoke,
        // export/deletion requests): "the guardian's consent write authority ends
        // (guardian path requires childAge < 18)" (04/06). Guardian READ persists
        // through maturation_pending — it ends at the edge's `verified -> lapsed`,
        // not at the child's majority — so a read is not age-bounded here.
        const writeAgeOk = resource.subjectAge == null || resource.subjectAge < 18
        if (
          subject != null &&
          ctx.guardianOf.includes(subject) &&
          (!def.writes || writeAgeOk)
        ) {
          match = { via: 'guardian' }
          break
        }
      }
      // scope === 'platform' is only reachable via pg, handled above.
    }
  }

  if (match === null) return deny('out_of_scope', {})

  // 4. Role gate (platformGrant may satisfy this)
  if (match.via === 'platform') {
    if (!pg?.role) return deny('role_not_permitted', {})
  } else if (match.via === 'guardian') {
    // Guardianship itself is the authority; guardian is not a chapter role.
  } else if (match.via === 'own_self') {
    // Self-ownership of one's own account IS the authority; no chapter role gate.
  } else if (!def.roles.includes(match.membership.role)) {
    return deny('role_not_permitted', { role: match.membership.role })
  }
  // actorCondition is NOT overridden by platformGrant; it runs for everyone.
  if (def.actorCondition && !def.actorCondition(ctx)) {
    return deny('actor_condition_failed', {})
  }

  // 5. Actor consent gate (NO override, runs for everyone)
  const ownConsents = ctx.consentsByChild.get(ctx.account.id)
  for (const t of def.actorConsent?.(ctx, resource) ?? []) {
    if (!ownConsents?.[t]?.active) {
      return deny('actor_consent_missing', { type: t })
    }
  }

  // 6. Subject consent gate (NO override, from the resource snapshot)
  for (const req of def.subjectConsent?.(resource) ?? []) {
    const snap = consentSnapshotFor(resource, req.student, req.type)
    if (snap === undefined) {
      return deny('subject_consent_unknown', { student: req.student, type: req.type }) // fail closed
    }
    if (!snap.active || (req.scopeRef != null && snap.scopeRef !== req.scopeRef)) {
      return deny('subject_consent_missing', { student: req.student, type: req.type })
    }
  }

  // 7. Obligations
  const obligations: Obligation[] = []
  if (def.logsRead && resource.subjectIsMinor) {
    const actorPod =
      match.via === 'guardian' || match.via === 'platform' || match.via === 'own_self'
        ? null
        : match.membership.pod_id
    if (resource.subjectPodId !== actorPod) {
      obligations.push({ type: 'minor_record.read', detail: { subject: resource.subjectAccountId } })
    }
  }

  return { allowed: true, obligations }
}
