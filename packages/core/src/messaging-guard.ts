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
 * The direct-messaging capability names present in a registry-shaped object
 * (any record keyed by capability name). Empty for a compliant registry; the
 * no-DM guard asserts exactly that against the real REGISTRY.
 */
export function directMessagingCapabilities(registry: Record<string, unknown>): string[] {
  return Object.keys(registry).filter(isDirectMessagingCapability)
}
