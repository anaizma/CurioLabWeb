// -------------------------------------------------------------------------
// The no-direct-messaging guard (compliance-coppa.md 1.8; Part 3 code item 7).
//
// A CurioLab username is arguably NOT personal information under § 312.2 only
// because it "cannot be messaged from outside" and does not permit direct
// contact. That property is a design invariant, not an accident: the capability
// REGISTRY must never contain a direct-messaging / DM capability. This guard
// fails the moment a `message.send`-style capability is added, so the
// username-is-not-PII argument cannot silently rot.
// -------------------------------------------------------------------------

import { describe, expect, test } from 'vitest'
import { REGISTRY, directMessagingCapabilities } from '../src/index.js'

describe('no-direct-messaging guard (compliance 1.8)', () => {
  test('the real REGISTRY contains no direct-messaging capability', () => {
    expect(directMessagingCapabilities(REGISTRY)).toEqual([])
  })

  test('it fails if a message.send-style capability is ever added', () => {
    const withDm = {
      ...REGISTRY,
      'message.send': { scope: 'chapter', roles: [], writes: true },
    }
    expect(directMessagingCapabilities(withDm)).toContain('message.send')
  })

  test('other DM-shaped capability names are also caught', () => {
    for (const name of ['dm.send', 'chat.create', 'inbox.read', 'conversation.start']) {
      expect(directMessagingCapabilities({ [name]: {} })).toContain(name)
    }
  })

  test('legitimate feed / comment capabilities are NOT mistaken for messaging', () => {
    // Community posting and commenting are public-in-context, not direct
    // contact; they must not trip the guard.
    expect(directMessagingCapabilities(REGISTRY)).toEqual([])
    expect(
      directMessagingCapabilities({ 'feed.comment': {}, 'feed.post': {}, 'newsletter.draft': {} }),
    ).toEqual([])
  })
})
