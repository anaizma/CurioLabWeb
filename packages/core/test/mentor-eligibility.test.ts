// -------------------------------------------------------------------------
// §6 mentor eligibility as STATE (admin/director backend, REVIEW-GATED).
//
// Two concerns, both PURE (no IO):
//   1. `evaluateMentorEligibility` — a mentor is eligible iff ALL four components
//      (background_check, mandatory_reporter_training, cwru_affiliation_verified,
//      signed_code_of_conduct) are currently satisfied: present AND not past
//      their expiry as of `now`. Any missing or expired component makes them
//      ineligible, and is reported in `unmet`.
//   2. The `can` GATE (behind the flag, carried on the context as
//      `enforceMentorEligibility`): when enforcement is ON, a teaching-role
//      membership marked `mentorEligible: false` no longer confers the
//      STUDENT-FACING capability set — the decision denies opaque `out_of_scope`,
//      exactly as if the membership were absent. When enforcement is OFF (the
//      default / production posture), eligibility is ignored and current behavior
//      is preserved. A mentor's own non-student-facing actions are never gated.
// -------------------------------------------------------------------------

import { describe, expect, test } from 'vitest'
import {
  can,
  evaluateMentorEligibility,
  MENTOR_ELIGIBILITY_COMPONENTS,
  MENTOR_ELIGIBILITY_ROLES,
  STUDENT_FACING_CAPABILITIES,
  type AuthContext,
  type Capability,
  type MentorEligibilityComponent,
  type MentorEligibilityComponentSnapshot,
  type Membership,
  type Resource,
} from '../src/index.js'

const NOW = Date.UTC(2026, 6, 24, 12, 0, 0)
const YEAR = 365 * 86_400_000

// ---------------------------------------------------------------------------
// 1. The pure predicate
// ---------------------------------------------------------------------------
describe('evaluateMentorEligibility', () => {
  const allCurrent = (): Partial<
    Record<MentorEligibilityComponent, MentorEligibilityComponentSnapshot>
  > =>
    Object.fromEntries(
      MENTOR_ELIGIBILITY_COMPONENTS.map((c) => [c, { clearedAt: NOW - YEAR, expiresAt: NOW + YEAR }]),
    )

  test('eligible iff all four components are present and unexpired', () => {
    const r = evaluateMentorEligibility(allCurrent(), NOW)
    expect(r.eligible).toBe(true)
    expect(r.unmet).toEqual([])
  })

  test('a missing component makes the mentor ineligible', () => {
    const comps = allCurrent()
    delete comps.background_check
    const r = evaluateMentorEligibility(comps, NOW)
    expect(r.eligible).toBe(false)
    expect(r.unmet).toContain('background_check')
  })

  test('an expired component (background check past expiry) makes the mentor ineligible', () => {
    const comps = allCurrent()
    comps.background_check = { clearedAt: NOW - 2 * YEAR, expiresAt: NOW - 1 } // lapsed
    const r = evaluateMentorEligibility(comps, NOW)
    expect(r.eligible).toBe(false)
    expect(r.unmet).toEqual(['background_check'])
  })

  test('a component with no expiry (standing) counts as current', () => {
    const comps = allCurrent()
    comps.signed_code_of_conduct = { clearedAt: NOW - 3 * YEAR, expiresAt: null }
    expect(evaluateMentorEligibility(comps, NOW).eligible).toBe(true)
  })

  test('a component present but never cleared (clearedAt null) is unmet', () => {
    const comps = allCurrent()
    comps.cwru_affiliation_verified = { clearedAt: null, expiresAt: null }
    const r = evaluateMentorEligibility(comps, NOW)
    expect(r.eligible).toBe(false)
    expect(r.unmet).toContain('cwru_affiliation_verified')
  })

  test('an empty record is ineligible on all four', () => {
    const r = evaluateMentorEligibility({}, NOW)
    expect(r.eligible).toBe(false)
    expect(r.unmet).toEqual([...MENTOR_ELIGIBILITY_COMPONENTS])
  })
})

// ---------------------------------------------------------------------------
// 2. The can() gate — flag on vs off
// ---------------------------------------------------------------------------
const C1 = 'chapter-C1'
const POD1 = 'pod-1'

function mentorMem(eligible: boolean | undefined): Membership {
  return {
    chapter_id: C1,
    role: 'junior_mentor',
    status: 'active',
    pod_id: POD1,
    tier: null,
    active_from: NOW - YEAR,
    active_until: NOW + YEAR,
    ...(eligible === undefined ? {} : { mentorEligible: eligible }),
  }
}

function mentorCtx(id: string, mem: Membership, enforce: boolean): AuthContext {
  return {
    now: NOW,
    account: { id, status: 'active', age: 30, maturation_state: 'self_managed', credential_owner: 'self_private' },
    session: { mode: 'full', expires_at: NOW + 3_600_000, revoked_at: null },
    memberships: [mem],
    guardianOf: [],
    consentsByChild: new Map(),
    enforceMentorEligibility: enforce,
  }
}

const postInPod1: Resource = { id: 'post-1', chapter_id: C1, pod_id: POD1 }
const childRecordInPod: Resource = {
  subjectAccountId: 'acct-child', subjectAge: 15, subjectIsMinor: true,
  chapter_id: C1, pod_id: POD1, subjectPodId: POD1,
}

describe('can() student-facing gate (flag ON)', () => {
  test('an ELIGIBLE mentor is allowed a student-facing capability (feed.moderate)', () => {
    const ctx = mentorCtx('m-ok', mentorMem(true), true)
    expect(can(ctx, 'feed.moderate', postInPod1).allowed).toBe(true)
  })

  test('an INELIGIBLE mentor is DENIED the same capability (opaque out_of_scope)', () => {
    const ctx = mentorCtx('m-bad', mentorMem(false), true)
    const d = can(ctx, 'feed.moderate', postInPod1)
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.reason).toBe('out_of_scope')
  })

  test('an ineligible mentor is denied student.view_record too', () => {
    const ctx = mentorCtx('m-bad', mentorMem(false), true)
    expect(can(ctx, 'student.view_record', childRecordInPod).allowed).toBe(false)
  })

  test('an ineligible mentor is denied feed.post (participant student-facing surface)', () => {
    const ctx = mentorCtx('m-bad', mentorMem(false), true)
    expect(can(ctx, 'feed.post', postInPod1).allowed).toBe(false)
  })
})

describe('can() student-facing gate (flag OFF — production posture)', () => {
  test('an ineligible mentor keeps current access when enforcement is OFF', () => {
    const ctx = mentorCtx('m-bad', mentorMem(false), false)
    expect(can(ctx, 'feed.moderate', postInPod1).allowed).toBe(true)
    expect(can(ctx, 'student.view_record', childRecordInPod).allowed).toBe(true)
  })

  test('with no enforcement flag at all, behavior is unchanged', () => {
    const ctx = mentorCtx('m-bad', mentorMem(false), false)
    delete (ctx as { enforceMentorEligibility?: boolean }).enforceMentorEligibility
    expect(can(ctx, 'feed.moderate', postInPod1).allowed).toBe(true)
  })
})

describe('the gate is narrow', () => {
  test('feed.report (a safety valve) is NOT in the student-facing gated set', () => {
    expect(STUDENT_FACING_CAPABILITIES.has('feed.report' as Capability)).toBe(false)
    const ctx = mentorCtx('m-bad', mentorMem(false), true)
    expect(can(ctx, 'feed.report', postInPod1).allowed).toBe(true)
  })

  test('the gated roles are exactly the teaching/mentor roles (student not included)', () => {
    expect(MENTOR_ELIGIBILITY_ROLES).toContain('junior_mentor')
    expect(MENTOR_ELIGIBILITY_ROLES).not.toContain('student')
    expect(MENTOR_ELIGIBILITY_ROLES).not.toContain('comms_associate')
  })

  test('a comms_associate (not a mentor role) is never eligibility-gated even if flagged', () => {
    const mem: Membership = {
      chapter_id: C1, role: 'comms_associate', status: 'active', pod_id: null,
      tier: null, active_from: NOW - YEAR, active_until: NOW + YEAR, mentorEligible: false,
    }
    const ctx = mentorCtx('comms', mem, true)
    // comms holds feed.post as a PARTICIPANT; eligibility does not apply to it.
    expect(can(ctx, 'feed.post', { id: 'p', chapter_id: C1, pod_id: null }).allowed).toBe(true)
  })
})
