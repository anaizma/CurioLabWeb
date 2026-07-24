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

  // -------------------------------------------------------------------------
  // COUNSEL-GATED mentor-student DM exemption (mentor-student-dm-design.md Part B).
  // The Phase-1 mentor-student DM capabilities trip the guard because a student IS
  // a party (that is the whole COPPA posture change). The exemption is amended
  // NARROWLY: it admits ONLY the fully-gated supervised-pair shape and STILL trips
  // for anything broader. dm.enable / dm.oversee / safety_officer.assign are
  // staff-only (no student party) and ride the existing guardian-staff exemption;
  // only the two PARTICIPANT caps (dm.message, dm.read_own) — which include a
  // student — need the new rule.
  // -------------------------------------------------------------------------
  const PAIR_PARTICIPANT_ROLES = [
    'student',
    'junior_mentor',
    'senior_instructor',
    'lead_instructor',
    'chapter_director',
  ]

  test('the exact Phase-1 mentor-student DM participant caps are EXEMPT (fully-gated pair shape)', () => {
    expect(
      directMessagingCapabilities({
        'dm.message': { scope: 'chapter', roles: PAIR_PARTICIPANT_ROLES, writes: true, pairGated: true },
        'dm.read_own': { scope: 'chapter', roles: PAIR_PARTICIPANT_ROLES, writes: false, pairGated: true },
      }),
    ).toEqual([])
  })

  test('the staff-only DM caps (dm.oversee safety_officer, dm.enable director) are exempt via the staff channel rule', () => {
    expect(
      directMessagingCapabilities({
        'dm.oversee': { scope: 'chapter', roles: ['safety_officer'], writes: true },
        'dm.enable': { scope: 'chapter', roles: ['chapter_director'], writes: true },
      }),
    ).toEqual([])
  })

  // Phase 3 adds two more staff-only DM caps: the safety-officer guardian-
  // visibility suspension and the second-adult acknowledgement. Both are
  // chapter-scoped with a non-empty staff-role floor that excludes student —
  // no student is ever a party — so they ride the same staff-channel exemption
  // (a `dm` segment name alone must not trip; the def SHAPE is what admits them).
  test('the Phase-3 staff DM caps (dm.suspend_guardian_visibility, dm.acknowledge_visibility_suspension) are exempt', () => {
    expect(
      directMessagingCapabilities({
        'dm.suspend_guardian_visibility': { scope: 'chapter', roles: ['safety_officer'], writes: true },
        'dm.acknowledge_visibility_suspension': {
          scope: 'chapter',
          roles: ['chapter_director', 'safety_officer'],
          writes: true,
        },
      }),
    ).toEqual([])
  })

  test('the real REGISTRY contains the Phase-3 DM caps and still trips nothing', () => {
    expect('dm.suspend_guardian_visibility' in REGISTRY).toBe(true)
    expect('dm.acknowledge_visibility_suspension' in REGISTRY).toBe(true)
    expect(directMessagingCapabilities(REGISTRY)).toEqual([])
  })

  test('a student-to-student dm cap STILL trips even if marked pairGated (no mentor party)', () => {
    expect(
      directMessagingCapabilities({ 'dm.peer': { scope: 'chapter', roles: ['student'], writes: true, pairGated: true } }),
    ).toContain('dm.peer')
  })

  test('a bare/empty-roles dm cap STILL trips', () => {
    expect(
      directMessagingCapabilities({ 'dm.message': { scope: 'chapter', roles: [], writes: true } }),
    ).toContain('dm.message')
  })

  test('an un-gated student dm cap (no pairGated marker) STILL trips', () => {
    expect(
      directMessagingCapabilities({ 'dm.message': { scope: 'chapter', roles: ['student', 'junior_mentor'], writes: true } }),
    ).toContain('dm.message')
  })

  test('a pod-scoped or over-broad-role pair cap STILL trips (shape must be exact)', () => {
    // pod scope, not chapter
    expect(
      directMessagingCapabilities({ 'dm.message': { scope: 'pod', roles: PAIR_PARTICIPANT_ROLES, writes: true, pairGated: true } }),
    ).toContain('dm.message')
    // a role outside the participant floor (comms_associate) sneaking in
    expect(
      directMessagingCapabilities({
        'dm.message': { scope: 'chapter', roles: ['student', 'comms_associate'], writes: true, pairGated: true },
      }),
    ).toContain('dm.message')
  })
})
