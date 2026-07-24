// -------------------------------------------------------------------------
// §6 mentor eligibility as STATE (admin/director backend, REVIEW-GATED).
//
// A mentor's youth-facing access is contingent on FOUR eligibility components
// each being CURRENTLY satisfied:
//   - background_check           (cleared, with a hard expiry)
//   - mandatory_reporter_training(completed, optional expiry)
//   - cwru_affiliation_verified  (verified, optional expiry)
//   - signed_code_of_conduct     (signed, versioned; optional expiry)
//
// This module is PURE — no IO. It owns:
//   * the component set + the mentor roles the requirement applies to;
//   * the precise STUDENT-FACING capability set the gate covers;
//   * `evaluateMentorEligibility`, computing "eligible iff all four are current"
//     from a snapshot of the latest per-component clearances + `now`.
//
// The ENFORCEMENT (denying an ineligible mentor those capabilities, and the
// auto-revoke sweep) is gated behind the app-layer flag MENTOR_ELIGIBILITY_ENFORCED
// (default OFF) until legal review. `can` reads the eligibility snapshot + the
// enforcement flag off the AuthContext; nothing here does IO, so core stays pure.
// -------------------------------------------------------------------------

import type { Capability, Role } from './types.js'

/** The four eligibility components, in a stable order. */
export const MENTOR_ELIGIBILITY_COMPONENTS = [
  'background_check',
  'mandatory_reporter_training',
  'cwru_affiliation_verified',
  'signed_code_of_conduct',
] as const

export type MentorEligibilityComponent = (typeof MENTOR_ELIGIBILITY_COMPONENTS)[number]

/**
 * The roles the eligibility requirement applies to: the teaching / mentor tiers
 * that have direct youth contact. A `student`, `alumni`, `comms_associate`, or a
 * platform role is never eligibility-gated. Matches the registry's TEACHING set.
 */
export const MENTOR_ELIGIBILITY_ROLES: readonly Role[] = [
  'junior_mentor',
  'senior_instructor',
  'lead_instructor',
  'chapter_director',
]

/**
 * The precise set of STUDENT-FACING capabilities a mentor holds that the gate
 * withdraws when the mentor is ineligible (and enforcement is on): the shared
 * student feed (view/post/comment/react + moderation + on-sight safety hide),
 * report resolution, project verification, media review, narrative review/remove,
 * reading a student record, and assisting a minor's account recovery.
 *
 * Deliberately EXCLUDED: `feed.report` (a safety valve everyone keeps),
 * `project.create` (opening one's own project, not accessing a student), and every
 * self-service / account-management capability — an ineligible mentor keeps their
 * own account actions, they only lose youth-facing access.
 */
export const STUDENT_FACING_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  'feed.view',
  'feed.post',
  'feed.comment',
  'feed.react',
  'feed.moderate',
  'feed.hide_safety',
  'moderation.resolve',
  'project.verify',
  'media.review',
  'narrative.review',
  'narrative.remove',
  'student.view_record',
  'account.assist_recovery',
])

/** The latest clearance snapshot for one component (epoch-ms), used by the predicate. */
export interface MentorEligibilityComponentSnapshot {
  /** When the component was cleared/completed/verified/signed; null = never. */
  clearedAt: number | null
  /** The expiry, or null for a standing (non-expiring) clearance. */
  expiresAt: number | null
}

export interface MentorEligibilityResult {
  /** True iff every required component is present and unexpired as of `now`. */
  eligible: boolean
  /** The components that are missing or expired (empty iff eligible). */
  unmet: MentorEligibilityComponent[]
}

/** A component is current iff it was cleared and is not past its expiry at `now`. */
export function isComponentCurrent(
  snap: MentorEligibilityComponentSnapshot | undefined,
  now: number,
): boolean {
  if (snap == null || snap.clearedAt == null) return false
  if (snap.expiresAt != null && snap.expiresAt <= now) return false
  return true
}

/**
 * Compute mentor eligibility from the latest per-component snapshots + `now`.
 * Eligible iff ALL four components are current; `unmet` lists the ones that are
 * missing or expired. Pure and deterministic given its inputs.
 */
export function evaluateMentorEligibility(
  components: Partial<Record<MentorEligibilityComponent, MentorEligibilityComponentSnapshot>>,
  now: number,
): MentorEligibilityResult {
  const unmet = MENTOR_ELIGIBILITY_COMPONENTS.filter((c) => !isComponentCurrent(components[c], now))
  return { eligible: unmet.length === 0, unmet }
}
