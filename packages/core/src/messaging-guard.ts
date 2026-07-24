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
 * The teaching/mentor roles that are the ADULT counterpart of a supervised
 * mentor-student DM pair. A student-only cap (no mentor party) is not the pair.
 */
const DM_PAIR_TEACHING_ROLES = [
  'junior_mentor',
  'senior_instructor',
  'lead_instructor',
  'chapter_director',
] as const

/** The complete, closed participant floor of the supervised pair: a student + a mentor. */
const DM_PAIR_PARTICIPANT_ROLES = new Set<string>(['student', ...DM_PAIR_TEACHING_ROLES])

/**
 * COUNSEL-GATED exemption for the mentor-student DM PARTICIPANT capabilities
 * (mentor-student-dm-design.md Part B). This admission is the deliberate,
 * narrowly-scoped COPPA posture change: it lets a STUDENT be a party to a
 * capability — and NOTHING here, or in the guard, authorizes the feature to run.
 * Enabling it requires `MENTOR_DM_ENABLED` (default false) AND the Part B legal
 * sign-off; the amendment only keeps the build green while the feature stays dark.
 *
 * Keyed on def SHAPE, never the name. It admits a def ONLY when it is the exact
 * fully-gated supervised-pair shape:
 *   - scope is EXACTLY 'chapter' (not pod, not multi-scope);
 *   - it carries the `pairGated` marker (asserting it is only ever invoked behind
 *     `canDirectMessage`: pod assignment + a current mentor_dm grant + mentor
 *     eligibility + the chapter switch + the global flag);
 *   - its roles are a NON-EMPTY subset of the closed participant floor {student} ∪
 *     the teaching roles, INCLUDING `student` (a participant) AND at least one
 *     teaching role (the mentor counterpart + the always-reading safety officer).
 * Anything broader STILL trips: student-to-student (no teaching party), a
 * bare/empty-roles cap, an un-`pairGated` student cap, a pod-scoped cap, or a cap
 * admitting a role outside the participant floor.
 *
 * The staff-only DM caps (dm.enable, dm.oversee) have NO student party and ride
 * the existing `isSanctionedGuardianStaffChannel` staff exemption; only these
 * two participant caps need the new rule.
 */
function isMentorStudentDmPair(def: unknown): boolean {
  if (def === null || typeof def !== 'object') return false
  const d = def as { scope?: unknown; roles?: unknown; pairGated?: unknown }
  if (d.pairGated !== true) return false
  const scopes = Array.isArray(d.scope) ? d.scope : d.scope != null ? [d.scope] : []
  if (scopes.length !== 1 || scopes[0] !== 'chapter') return false
  if (!Array.isArray(d.roles) || d.roles.length === 0) return false
  const roles = d.roles.map(String)
  if (!roles.every((r) => DM_PAIR_PARTICIPANT_ROLES.has(r))) return false
  if (!roles.includes('student')) return false // a student must be a party
  if (!roles.some((r) => (DM_PAIR_TEACHING_ROLES as readonly string[]).includes(r))) return false
  return true
}

/**
 * The direct-messaging capability names present in a registry-shaped object
 * (any record keyed by capability name). Empty for a compliant registry; the
 * no-DM guard asserts exactly that against the real REGISTRY. A name that matches
 * the DM pattern is still reported UNLESS its def is one of the two sanctioned
 * shapes:
 *   - the guardian <-> chapter-staff channel (Feature 3, adult-to-adult — never a
 *     student party); see `isSanctionedGuardianStaffChannel`; OR
 *   - the COUNSEL-GATED, fully-gated mentor-student DM participant shape (Phase 1);
 *     see `isMentorStudentDmPair`. Built dark behind MENTOR_DM_ENABLED.
 */
export function directMessagingCapabilities(registry: Record<string, unknown>): string[] {
  return Object.keys(registry).filter(
    (name) =>
      isDirectMessagingCapability(name) &&
      !isSanctionedGuardianStaffChannel(registry[name]) &&
      !isMentorStudentDmPair(registry[name]),
  )
}
