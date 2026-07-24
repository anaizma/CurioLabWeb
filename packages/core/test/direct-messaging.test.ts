// -------------------------------------------------------------------------
// canDirectMessage — the pure mentor-student DM eligibility predicate
// (mentor-student-dm-design.md C.3). True only when ALL of: the student is in a
// pod the mentor is assigned to in the current term (assignment); a current
// (non-expired, non-revoked) mentor_dm grant is on file; mentor eligibility
// passes; the chapter DM switch is on; AND the global MENTOR_DM_ENABLED build
// flag is on. Re-evaluated at every send and read. Deterministic injected `now`.
// -------------------------------------------------------------------------

import { describe, expect, test } from 'vitest'
import {
  canDirectMessage,
  type DirectMessageMentor,
  type DirectMessageStudent,
} from '../src/direct-messaging.js'

const NOW = Date.UTC(2026, 6, 24, 12, 0, 0)
const TERM_END = Date.UTC(2026, 11, 15, 0, 0, 0)

// A fully-authorized mentor: assigned to POD1 this term, eligible, chapter + global on.
function mentor(overrides: Partial<DirectMessageMentor> = {}): DirectMessageMentor {
  return {
    assignedPodIds: ['pod-1'],
    eligibility: { eligible: true, unmet: [] },
    chapterDmEnabled: true,
    globalDmEnabled: true,
    ...overrides,
  }
}

// A fully-authorized student: in POD1 this term, with a current mentor_dm grant.
function student(overrides: Partial<DirectMessageStudent> = {}): DirectMessageStudent {
  return {
    currentTermPodId: 'pod-1',
    mentorDmGrant: { expiresAt: TERM_END, revokedAt: null },
    ...overrides,
  }
}

describe('canDirectMessage', () => {
  test('true when assignment + current mentor_dm grant + eligibility + chapter + global all hold', () => {
    expect(canDirectMessage(mentor(), student(), NOW)).toBe(true)
  })

  test('false when the student is in no pod the mentor is assigned to (assignment leg)', () => {
    expect(canDirectMessage(mentor({ assignedPodIds: ['pod-2'] }), student(), NOW)).toBe(false)
    expect(canDirectMessage(mentor(), student({ currentTermPodId: null }), NOW)).toBe(false)
    expect(canDirectMessage(mentor({ assignedPodIds: [] }), student(), NOW)).toBe(false)
  })

  test('false when there is no mentor_dm grant on file', () => {
    expect(canDirectMessage(mentor(), student({ mentorDmGrant: null }), NOW)).toBe(false)
  })

  test('false when the mentor_dm grant is revoked', () => {
    expect(
      canDirectMessage(mentor(), student({ mentorDmGrant: { expiresAt: TERM_END, revokedAt: NOW - 1 } }), NOW),
    ).toBe(false)
  })

  test('false when the mentor_dm grant has expired at term end', () => {
    const afterTerm = TERM_END + 1
    expect(
      canDirectMessage(mentor(), student({ mentorDmGrant: { expiresAt: TERM_END, revokedAt: null } }), afterTerm),
    ).toBe(false)
    // still valid an instant before expiry
    expect(
      canDirectMessage(mentor(), student({ mentorDmGrant: { expiresAt: TERM_END, revokedAt: null } }), TERM_END - 1),
    ).toBe(true)
  })

  test('false when mentor eligibility does not pass', () => {
    expect(
      canDirectMessage(mentor({ eligibility: { eligible: false, unmet: ['background_check'] } }), student(), NOW),
    ).toBe(false)
  })

  test('false when the chapter DM switch is off', () => {
    expect(canDirectMessage(mentor({ chapterDmEnabled: false }), student(), NOW)).toBe(false)
  })

  test('false when the global MENTOR_DM_ENABLED flag is off, regardless of everything else', () => {
    expect(canDirectMessage(mentor({ globalDmEnabled: false }), student(), NOW)).toBe(false)
  })

  test('a standing (null-expiry) grant is treated as current, but term expiry still applies when set', () => {
    expect(
      canDirectMessage(mentor(), student({ mentorDmGrant: { expiresAt: null, revokedAt: null } }), NOW),
    ).toBe(true)
  })
})
