// -------------------------------------------------------------------------
// canDirectMessage — the pure mentor-student DM eligibility predicate
// (mentor-student-dm-design.md C.3, Phase 1). PURE and deterministic: no IO, an
// injected `now`. The app layer resolves the four DB legs (pod assignment in the
// current term, the mentor_dm consent grant, mentor eligibility, the chapter DM
// switch) plus the global build flag into the snapshots below and calls this at
// EVERY send and read — any leg lapsing cuts access immediately, with no human
// remembering.
//
// The predicate is true ONLY when ALL hold:
//   1. globalDmEnabled — the MENTOR_DM_ENABLED build flag (Part D). When false the
//      whole feature is globally DARK: no send flows, no matter the chapter switch.
//   2. chapterDmEnabled — the per-chapter DM switch is on (Part D enable gate).
//   3. eligibility.eligible — evaluateMentorEligibility (P6b) passes.
//   4. assignment — the student's current-term pod is one the mentor is assigned
//      to (the pod/pod_assignment leg).
//   5. a CURRENT mentor_dm grant — non-revoked AND non-expired at `now` (the grant
//      expires at term end, so this also enforces the cohort boundary).
//
// This mirrors evaluateMentorEligibility's placement: a pure predicate in core,
// tested with deterministic inputs, composed by the app layer. It is deliberately
// NOT a capability in the registry — it is a precondition the DM services check in
// addition to `can(ctx, 'dm.message'|'dm.read_own', ...)`.
// -------------------------------------------------------------------------

import type { MentorEligibilityResult } from './mentor-eligibility.js'

/** A mentor_dm consent-grant snapshot: its expiry and revocation, epoch-ms. */
export interface DmGrantSnapshot {
  /** The renewal-clock expiry (term end); null = standing (no expiry). */
  expiresAt: number | null
  /** When the grant was revoked; null = never revoked. */
  revokedAt: number | null
}

/** The mentor side of a DM pair, resolved from the DB + config. */
export interface DirectMessageMentor {
  /** The pods the mentor is assigned to in the CURRENT term (the assignment leg). */
  assignedPodIds: readonly string[]
  /** The mentor's eligibility as of `now` (evaluateMentorEligibility output). */
  eligibility: MentorEligibilityResult
  /** The chapter DM switch (Part D enable gate). */
  chapterDmEnabled: boolean
  /** The global MENTOR_DM_ENABLED build flag (Part D). False => globally dark. */
  globalDmEnabled: boolean
}

/** The student side of a DM pair, resolved from the DB. */
export interface DirectMessageStudent {
  /** The student's pod in the CURRENT term (null = not in a current-term pod). */
  currentTermPodId: string | null
  /** The current mentor_dm guardian consent grant, or null if none on file. */
  mentorDmGrant: DmGrantSnapshot | null
}

/** A grant is current iff it exists, is not revoked, and is not past expiry at `now`. */
function grantCurrent(grant: DmGrantSnapshot | null, now: number): boolean {
  if (grant === null) return false
  if (grant.revokedAt !== null) return false
  if (grant.expiresAt !== null && grant.expiresAt <= now) return false
  return true
}

/**
 * Whether this mentor may direct-message this student at `now`. All five legs
 * must hold; any missing leg (or either switch off) is false. Deterministic.
 */
export function canDirectMessage(
  mentor: DirectMessageMentor,
  student: DirectMessageStudent,
  now: number,
): boolean {
  if (!mentor.globalDmEnabled) return false
  if (!mentor.chapterDmEnabled) return false
  if (!mentor.eligibility.eligible) return false
  if (student.currentTermPodId === null) return false
  if (!mentor.assignedPodIds.includes(student.currentTermPodId)) return false
  if (!grantCurrent(student.mentorDmGrant, now)) return false
  return true
}
