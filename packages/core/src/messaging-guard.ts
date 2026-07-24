// -------------------------------------------------------------------------
// No-direct-messaging guard (compliance-coppa.md 1.8; Part 3 code item 7).
//
// § 312.2 counts a screen or user name as personal information only where it
// functions like online contact information — i.e. where it permits DIRECT
// CONTACT. CurioLab's username is designed not to: it only logs in and cannot be
// messaged. Holding that line is a property of the capability set: there is no
// direct-messaging capability, so no code path exists to contact an account by
// username. This module names that invariant as data (a pattern) plus a pure
// predicate over any registry-shaped object, so a guard test can assert it and
// fail the moment a `message.send`-style capability is introduced.
// -------------------------------------------------------------------------

/**
 * Capability-name segments that denote direct, account-to-account contact.
 * Matched per dot/underscore-delimited segment so `message.send`, `dm.send`,
 * `chat.create`, `inbox.read`, and `conversation.start` are caught while
 * community capabilities that are public-in-context (`feed.post`,
 * `feed.comment`, `newsletter.draft`) are not. Deliberately a VALUE, not code:
 * broadening what counts as messaging is a one-line edit here.
 */
export const DIRECT_MESSAGING_SEGMENTS: readonly string[] = [
  'dm',
  'message',
  'messages',
  'messaging',
  'chat',
  'chats',
  'inbox',
  'conversation',
  'conversations',
  'pm',
  'whisper',
] as const

const DIRECT_MESSAGING_SEGMENT_SET = new Set(DIRECT_MESSAGING_SEGMENTS)

/** Whether a single capability name denotes direct messaging. */
export function isDirectMessagingCapability(capability: string): boolean {
  return capability
    .split(/[._]/)
    .some((segment) => DIRECT_MESSAGING_SEGMENT_SET.has(segment.toLowerCase()))
}

/**
 * The ONE sanctioned exemption: the guardian <-> chapter-staff messaging channel
 * (guardian/director portal, Feature 3). The § 312.2 property the guard protects
 * is that a STUDENT cannot be directly contacted by username — so an adult-only
 * channel between a guardian and their child's chapter's staff does NOT undermine
 * it (a student is never a party: not a sender, not a recipient). Exemption keys on
 * the def SHAPE, never the name, so it admits ONLY the affirmatively-adult channel
 * and a student-facing message capability still trips:
 *   - scope 'guardian' (the guardian's own thread; a guardian is an adult), OR
 *   - scope 'chapter'/'pod' with a NON-EMPTY roles floor that excludes `student`
 *     (and `alumni`) — i.e. staff-only, a mentor/instructor/director replying.
 * A bare/empty-roles or student-including message capability is NOT exempt.
 */
function isSanctionedGuardianStaffChannel(def: unknown): boolean {
  if (def === null || typeof def !== 'object') return false
  const d = def as { scope?: unknown; roles?: unknown }
  const scopes = Array.isArray(d.scope) ? d.scope : d.scope != null ? [d.scope] : []
  if (scopes.length === 0) return false
  const rolesArr = Array.isArray(d.roles) ? (d.roles as unknown[]).map(String) : null

  // Guardian-scoped: the guardian's own thread (adult). Exempt.
  if (scopes.every((s) => s === 'guardian')) return true

  // Chapter/pod-scoped staff channel: a NON-EMPTY roles floor that excludes
  // student/alumni (staff-only) — a mentor/instructor/director replying.
  if (
    scopes.every((s) => s === 'chapter' || s === 'pod') &&
    rolesArr !== null &&
    rolesArr.length > 0 &&
    !rolesArr.includes('student') &&
    !rolesArr.includes('alumni')
  ) {
    return true
  }
  return false
}

/**
 * The direct-messaging capability names present in a registry-shaped object
 * (any record keyed by capability name). Empty for a compliant registry; the
 * no-DM guard asserts exactly that against the real REGISTRY. A name that matches
 * the DM pattern is still reported UNLESS its def is the one sanctioned
 * guardian <-> chapter-staff channel (Feature 3, adult-to-adult — never student
 * contact); see `isSanctionedGuardianStaffChannel`.
 */
export function directMessagingCapabilities(registry: Record<string, unknown>): string[] {
  return Object.keys(registry).filter(
    (name) =>
      isDirectMessagingCapability(name) && !isSanctionedGuardianStaffChannel(registry[name]),
  )
}
