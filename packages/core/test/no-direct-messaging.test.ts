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

  // The sanctioned guardian <-> chapter-staff channel (Feature 3) is EXEMPT: it is
  // adult-to-adult (a guardian and their child's chapter's staff), never
  // student-directed, so a student still cannot be contacted by username — the
  // § 312.2 property the guard protects is intact. Exemption keys on the def SHAPE
  // (guardian scope, or chapter/pod scope with non-empty staff roles that exclude
  // student), NOT on the name — so a STUDENT-facing message capability still trips.
  test('the guardian-scoped and chapter-staff messaging caps are exempt (adult-to-adult, not student contact)', () => {
    expect(
      directMessagingCapabilities({
        'message.send': { scope: 'guardian', roles: [], writes: true },
        'message.view_own': { scope: 'guardian', roles: [], writes: false },
        'message.view': {
          scope: 'chapter',
          roles: ['junior_mentor', 'senior_instructor', 'lead_instructor', 'chapter_director'],
          writes: false,
        },
        'message.reply': {
          scope: 'chapter',
          roles: ['junior_mentor', 'senior_instructor', 'lead_instructor', 'chapter_director'],
          writes: true,
        },
      }),
    ).toEqual([])
  })

  test('a STUDENT-facing message capability still trips (a student could be a party)', () => {
    // A message capability a student role can invoke, or a bare chapter one with no
    // staff-role floor, is NOT the sanctioned channel — it must still trip.
    expect(
      directMessagingCapabilities({ 'message.send': { scope: 'chapter', roles: ['student'], writes: true } }),
    ).toContain('message.send')
    expect(
      directMessagingCapabilities({ 'message.dm': { scope: 'pod', roles: ['student', 'junior_mentor'] } }),
    ).toContain('message.dm')
  })
})
