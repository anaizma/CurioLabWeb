import { platformGrant } from './platformGrant.js'
import { REGISTRY } from './registry.js'
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
        const m = pickMembership(ctx, def.roles, (mm) => mm.chapter_id === resource.chapter_id)
        if (m) {
          match = { via: 'chapter', membership: m }
          break
        }
      } else if (scope === 'pod') {
        const m = pickMembership(
          ctx,
          def.roles,
          (mm) => mm.pod_id !== null && mm.pod_id === resource.pod_id,
        )
        if (m) {
          match = { via: 'pod', membership: m }
          break
        }
      } else if (scope === 'own') {
        const owns = resource.ownerAccountId != null && resource.ownerAccountId === ctx.account.id
        if (owns && (def.ownCondition?.(ctx) ?? true)) {
          const m = pickMembership(ctx, def.roles, () => true)
          if (m) {
            match = { via: 'own', membership: m }
            break
          }
        }
      } else if (scope === 'guardian') {
        const subject = resource.subjectAccountId
        // Guardian authority is over a verified minor child only; it ends at
        // the child's majority (encoded here as the general guardian-path rule,
        // consistent with the guardianship lapse at coming-of-age).
        if (
          subject != null &&
          ctx.guardianOf.includes(subject) &&
          (resource.subjectAge == null || resource.subjectAge < 18)
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
    const actorPod = match.via === 'guardian' || match.via === 'platform' ? null : match.membership.pod_id
    if (resource.subjectPodId !== actorPod) {
      obligations.push({ type: 'minor_record.read', detail: { subject: resource.subjectAccountId } })
    }
  }

  return { allowed: true, obligations }
}
