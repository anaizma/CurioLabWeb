import { REGISTRY } from './registry.js'
import type { AuthContext, Capability, Resource, Role } from './types.js'

/** True when the actor holds an in-force membership with the given role. */
function hasRole(ctx: AuthContext, role: Role): boolean {
  return ctx.memberships.some((m) => {
    if (m.role !== role || m.status !== 'active') return false
    if (m.active_from !== null && m.active_from > ctx.now) return false
    if (m.active_until !== null && ctx.now >= m.active_until) return false
    return true
  })
}

/**
 * The platform override, consulted ONLY at the scope and role steps (never at
 * consent). A `platform_admin` satisfies scope and role for everything (consent
 * gates still run). A `platform_staff` satisfies them for reads, and for the
 * one write exception of a zero-student newsletter issue.
 */
export function platformGrant(
  ctx: AuthContext,
  capability: Capability,
  resource: Resource,
): { scope: boolean; role: boolean } | null {
  if (hasRole(ctx, 'platform_admin')) return { scope: true, role: true }
  if (hasRole(ctx, 'platform_staff')) {
    if (!REGISTRY[capability].writes) return { scope: true, role: true }
    if (
      capability === 'newsletter.publish' &&
      (resource.studentAuthoredItems?.length ?? 0) === 0
    ) {
      return { scope: true, role: true }
    }
  }
  return null
}
