import { describe, expect, test } from 'vitest'
import {
  ALL_FIXTURES,
  ALL_ROLES,
  REGISTRY,
  actors,
  coverage,
  expectAllow,
  expectDeny,
  // resources
  postInPod1,
  postInPod2,
  postInC2,
  postChapterC1,
  issueNoItems,
  issueConsented,
  issueUnconsented,
  issueMismatchedScope,
  issueSnapshotAbsent,
  platformIssueNoItems,
  platformIssueWithItem,
  projectOwnedBy,
  projectPublicConsented,
  projectPublicUnconsented,
  narrativeOwnedBy,
  narrativeReviewC1,
  applicationInC1,
  leadInC1,
  enrollmentInC1,
  inviteInC1,
  membershipInC1,
  guardianshipInC1,
  dobCorrectInC1,
  deletionRequestInC1,
  exportRequestInC1,
  safetyReport,
  ordinaryReport,
  childRecordOfS,
  childRecordInPod,
  childRecordOutOfPod,
  consentTargetChildS,
  consentTargetChild18,
  consentTargetSelf,
  verificationTargetSelf,
  guardianResourceOf,
  CHILD_S,
  OWNER_S18,
  type Role,
} from './fixtures.js'

// ===========================================================================
// Worked sweep 1: feed.comment (07-test-plan)
// ===========================================================================
describe('worked sweep: feed.comment', () => {
  test('student_minor_consented can comment on a post in own pod', () => {
    expectAllow(actors.student_minor_consented, 'feed.comment', postInPod1)
  })
  test('student_minor_no_participation denied (actor_consent_missing)', () => {
    expectDeny(actors.student_minor_no_participation, 'feed.comment', postInPod1, 'actor_consent_missing')
  })
  test('student_18 can comment on a post in own chapter', () => {
    expectAllow(actors.student_18, 'feed.comment', postChapterC1)
  })
  test('alumni denied (role_not_permitted)', () => {
    expectDeny(actors.alumni, 'feed.comment', postChapterC1, 'role_not_permitted')
  })
  test('alumni_with_active_mentor allowed, acting under the mentor membership', () => {
    expectAllow(actors.alumni_with_active_mentor, 'feed.comment', postInPod1)
  })
  test('guardian_of_S denied (out_of_scope)', () => {
    expectDeny(actors.guardian_of_S, 'feed.comment', postInPod1, 'out_of_scope')
  })
  test('junior_mentor_minor can comment on a post in own pod', () => {
    expectAllow(actors.junior_mentor_minor, 'feed.comment', postInPod1)
  })
  test('no_membership denied (out_of_scope)', () => {
    expectDeny(actors.no_membership, 'feed.comment', postInPod1, 'out_of_scope')
  })
  test('anonymous denied (no active account)', () => {
    expectDeny(actors.anonymous, 'feed.comment', postInPod1, 'account_not_active')
  })
  test('student_minor_consented denied on a post in C2 (out_of_scope)', () => {
    expectDeny(actors.student_minor_consented, 'feed.comment', postInC2, 'out_of_scope')
  })
})

// ===========================================================================
// Worked sweep 2: newsletter.publish (07-test-plan)
// ===========================================================================
describe('worked sweep: newsletter.publish', () => {
  test('chapter_director@C1, issue with no student items -> allow', () => {
    expectAllow(actors.chapter_director_c1, 'newsletter.publish', issueNoItems)
  })
  test('chapter_director@C1, consented student item -> allow', () => {
    expectAllow(actors.chapter_director_c1, 'newsletter.publish', issueConsented)
  })
  test('chapter_director@C1, unconsented student item -> subject_consent_missing', () => {
    expectDeny(actors.chapter_director_c1, 'newsletter.publish', issueUnconsented, 'subject_consent_missing')
  })
  test('chapter_director@C1, snapshot absent -> subject_consent_unknown', () => {
    expectDeny(actors.chapter_director_c1, 'newsletter.publish', issueSnapshotAbsent, 'subject_consent_unknown')
  })
  test('comms_associate@C1 -> role_not_permitted', () => {
    expectDeny(actors.comms_associate_c1, 'newsletter.publish', issueNoItems, 'role_not_permitted')
  })
  test('lead_instructor@C1 -> role_not_permitted', () => {
    expectDeny(actors.lead_instructor_c1, 'newsletter.publish', issueNoItems, 'role_not_permitted')
  })
  test('platform_admin with unconsented item -> subject_consent_missing (consent runs even for platform)', () => {
    expectDeny(actors.platform_admin, 'newsletter.publish', issueUnconsented, 'subject_consent_missing')
  })
  test('platform_staff with any student item -> denied (grant restricted to zero-student issues)', () => {
    expectDeny(actors.platform_staff, 'newsletter.publish', platformIssueWithItem, 'out_of_scope')
  })
  test('platform_staff, platform issue with no student items -> allow', () => {
    expectAllow(actors.platform_staff, 'newsletter.publish', platformIssueNoItems)
  })
  test('chapter_director@C2, issue in C1 -> out_of_scope', () => {
    expectDeny(actors.chapter_director_c2, 'newsletter.publish', issueNoItems, 'out_of_scope')
  })
})

// ===========================================================================
// The must-not register (core-layer rows)
// ===========================================================================
describe('must-not register (core)', () => {
  test('#1 permission is not a single account field: two memberships resolve independently by resource', () => {
    // multi_chapter_actor is junior_mentor@C1/pod1 AND student@C2/podX.
    expectAllow(actors.multi_chapter_actor, 'feed.moderate', postInPod1) // via the C1 mentor membership
    expectDeny(actors.multi_chapter_actor, 'feed.moderate', postInC2, 'role_not_permitted') // student in C2
  })

  test('#5 external_publication scoped to a different item denies (subject_consent_missing)', () => {
    expectDeny(actors.chapter_director_c1, 'newsletter.publish', issueMismatchedScope, 'subject_consent_missing')
  })

  test('#6 guardian cannot read the feed (out_of_scope; no chapter role)', () => {
    expectDeny(actors.guardian_of_S, 'feed.view', postInPod1, 'out_of_scope')
  })

  test('#7 non-authorized publish: comms and instructor deny (role_not_permitted)', () => {
    expectDeny(actors.comms_associate_c1, 'newsletter.publish', issueNoItems, 'role_not_permitted')
    expectDeny(actors.lead_instructor_c1, 'newsletter.publish', issueNoItems, 'role_not_permitted')
  })

  test('#7b student content published without naming consent -> subject_consent_missing', () => {
    expectDeny(actors.chapter_director_c1, 'newsletter.publish', issueUnconsented, 'subject_consent_missing')
  })

  test('#10 consent not overridden by role: platform_admin publish w/o subject consent -> subject_consent_missing', () => {
    expectDeny(actors.platform_admin, 'newsletter.publish', issueUnconsented, 'subject_consent_missing')
  })

  test('#11 (core) a write under read-only impersonation of a minor -> impersonation_write_forbidden', () => {
    expectDeny(actors.impersonation_minor_readonly, 'feed.post', postInPod1, 'impersonation_write_forbidden')
  })

  test('#12 alumni participates only under an active mentor membership', () => {
    expectDeny(actors.alumni, 'feed.comment', postChapterC1, 'role_not_permitted')
    expectAllow(actors.alumni_with_active_mentor, 'feed.comment', postInPod1)
  })

  test('#13 a minor cannot resolve a safety report', () => {
    const d = expectDeny(actors.junior_mentor_minor, 'moderation.resolve', safetyReport)
    expect(d.reason).toBe('actor_condition_failed')
  })

  test('#14 a minor reads the feed without participation consent -> denied', () => {
    expectDeny(actors.student_minor_no_participation, 'feed.view', postInPod1, 'actor_consent_missing')
  })

  test('#18 guardian cannot grant consent for an 18-year-old; student_18 self-grants allows', () => {
    expectDeny(actors.guardian_of_S, 'consent.grant', consentTargetChild18, 'out_of_scope')
    expectAllow(actors.student_18, 'consent.grant', consentTargetSelf(OWNER_S18, 18))
  })

  test('#19 guardian read does not persist past the lapse (out_of_scope)', () => {
    expectDeny(actors.guardian_of_S_lapsed, 'guardian.view_child_record', childRecordOfS, 'out_of_scope')
  })

  test('#20 stale-active membership past active_until denies at decision time (out_of_scope)', () => {
    expectDeny(actors.stale_student, 'feed.comment', postInPod1, 'out_of_scope')
  })

  test('#22 subject consent unknown is treated as absent (subject_consent_unknown)', () => {
    expectDeny(actors.chapter_director_c1, 'newsletter.publish', issueSnapshotAbsent, 'subject_consent_unknown')
  })

  test('#26 (core) a minor narrative edit is not self-publishable: needs narrative.review by staff', () => {
    // The minor may edit their own narrative...
    expectAllow(actors.student_minor_consented, 'profile.edit_narrative', narrativeOwnedBy(actors.student_minor_consented.account.id))
    // ...but cannot clear it to public themselves...
    expectDeny(actors.student_minor_consented, 'narrative.review', narrativeReviewC1, 'role_not_permitted')
    // ...only a director/lead can.
    expectAllow(actors.chapter_director_c1, 'narrative.review', narrativeReviewC1)
  })

  test('#27 a suspended account acts on nothing (account_not_active)', () => {
    expectDeny(actors.suspended, 'feed.view', postInPod1, 'account_not_active')
    expectDeny(actors.suspended, 'feed.comment', postInPod1, 'account_not_active')
  })

  test('#28 a closed account acts on nothing (account_not_active)', () => {
    expectDeny(actors.closed, 'feed.view', postInPod1, 'account_not_active')
  })

  test('#29 an expired session denies at decision time (session_invalid)', () => {
    expectDeny(actors.expired_session, 'feed.moderate', postInPod1, 'session_invalid')
  })

  test('#30 a revoked session denies immediately (session_invalid)', () => {
    expectDeny(actors.revoked_session, 'feed.moderate', postInPod1, 'session_invalid')
  })
})

// ===========================================================================
// Extra targeted coverage so every REGISTRY key has an asserted allow + deny.
// ===========================================================================
describe('capability coverage: allow and deny for every registry key', () => {
  test('feed.view', () => {
    expectAllow(actors.student_minor_consented, 'feed.view', postInPod1)
    expectDeny(actors.student_minor_no_participation, 'feed.view', postInPod1, 'actor_consent_missing')
  })

  test('feed.post', () => {
    expectAllow(actors.student_18, 'feed.post', postChapterC1)
    expectDeny(actors.student_minor_no_participation, 'feed.post', postInPod1, 'actor_consent_missing')
  })

  test('feed.react', () => {
    expectAllow(actors.student_18, 'feed.react', postChapterC1)
    expectDeny(actors.student_minor_no_participation, 'feed.react', postInPod1, 'actor_consent_missing')
  })

  test('feed.report', () => {
    expectAllow(actors.student_minor_consented, 'feed.report', postInPod1)
    expectDeny(actors.no_membership, 'feed.report', postInPod1, 'out_of_scope')
  })

  test('feed.moderate', () => {
    expectAllow(actors.lead_instructor_c1, 'feed.moderate', postInPod1)
    expectDeny(actors.student_18, 'feed.moderate', postChapterC1, 'role_not_permitted')
  })

  test('feed.hide_safety (a minor mentor may hide on sight)', () => {
    expectAllow(actors.junior_mentor_minor, 'feed.hide_safety', postInPod1)
    expectDeny(actors.student_18, 'feed.hide_safety', postChapterC1, 'role_not_permitted')
  })

  test('moderation.resolve', () => {
    expectAllow(actors.lead_instructor_c1, 'moderation.resolve', ordinaryReport)
    expectDeny(actors.junior_mentor_minor, 'moderation.resolve', safetyReport, 'actor_condition_failed')
  })

  test('newsletter.draft', () => {
    expectAllow(actors.comms_associate_c1, 'newsletter.draft', issueNoItems)
    expectDeny(actors.lead_instructor_c1, 'newsletter.draft', issueNoItems, 'role_not_permitted')
  })

  test('newsletter.publish', () => {
    expectAllow(actors.chapter_director_c1, 'newsletter.publish', issueConsented)
    expectDeny(actors.chapter_director_c1, 'newsletter.publish', issueUnconsented, 'subject_consent_missing')
  })

  test('project.create', () => {
    expectAllow(actors.student_18, 'project.create', { chapter_id: 'chapter-C1' })
    expectDeny(actors.alumni, 'project.create', { chapter_id: 'chapter-C1' }, 'role_not_permitted')
  })

  test('project.submit', () => {
    expectAllow(actors.student_18, 'project.submit', projectOwnedBy(actors.student_18.account.id))
    expectDeny(actors.student_18, 'project.submit', projectOwnedBy('someone-else'), 'out_of_scope')
  })

  test('project.verify (available to minors for now)', () => {
    expectAllow(actors.lead_instructor_c1, 'project.verify', projectOwnedBy('a-student'))
    expectAllow(actors.junior_mentor_minor, 'project.verify', projectOwnedBy('a-student'))
    expectDeny(actors.student_18, 'project.verify', projectOwnedBy('a-student'), 'role_not_permitted')
  })

  test('project.publish_public', () => {
    expectAllow(actors.chapter_director_c1, 'project.publish_public', projectPublicConsented)
    expectDeny(actors.chapter_director_c1, 'project.publish_public', projectPublicUnconsented, 'subject_consent_missing')
  })

  test('profile.edit_narrative', () => {
    expectAllow(actors.student_18, 'profile.edit_narrative', narrativeOwnedBy(actors.student_18.account.id))
    expectDeny(actors.student_18, 'profile.edit_narrative', narrativeOwnedBy('someone-else'), 'out_of_scope')
  })

  test('narrative.review', () => {
    expectAllow(actors.chapter_director_c1, 'narrative.review', narrativeReviewC1)
    expectDeny(actors.student_minor_consented, 'narrative.review', narrativeReviewC1, 'role_not_permitted')
  })

  test('verification.regenerate (scope own or guardian)', () => {
    expectAllow(actors.student_18, 'verification.regenerate', verificationTargetSelf(actors.student_18.account.id))
    expectAllow(actors.guardian_of_S, 'verification.regenerate', guardianResourceOf(CHILD_S))
    expectDeny(actors.no_membership, 'verification.regenerate', verificationTargetSelf('someone-else'), 'out_of_scope')
  })

  test('student.view_record (emits a minor_record.read obligation out of pod)', () => {
    const inPod = expectAllow(actors.lead_instructor_c1, 'student.view_record', childRecordInPod)
    expect(inPod.obligations).toHaveLength(0)
    const outPod = expectAllow(actors.lead_instructor_c1, 'student.view_record', childRecordOutOfPod)
    expect(outPod.obligations.map((o) => o.type)).toContain('minor_record.read')
    expectDeny(actors.student_18, 'student.view_record', childRecordInPod, 'role_not_permitted')
  })

  test('guardian.view_child_record (emits a read log)', () => {
    const d = expectAllow(actors.guardian_of_S, 'guardian.view_child_record', childRecordOfS)
    expect(d.obligations.map((o) => o.type)).toContain('minor_record.read')
    expectDeny(actors.guardian_of_S_lapsed, 'guardian.view_child_record', childRecordOfS, 'out_of_scope')
  })

  test('guardian.view_fee_status', () => {
    expectAllow(actors.guardian_of_S, 'guardian.view_fee_status', guardianResourceOf(CHILD_S))
    expectDeny(actors.no_membership, 'guardian.view_fee_status', guardianResourceOf(CHILD_S), 'out_of_scope')
  })

  test('consent.grant', () => {
    expectAllow(actors.guardian_of_S, 'consent.grant', consentTargetChildS)
    expectDeny(actors.guardian_of_S, 'consent.grant', consentTargetChild18, 'out_of_scope')
  })

  test('consent.revoke', () => {
    expectAllow(actors.guardian_of_S, 'consent.revoke', consentTargetChildS)
    expectDeny(actors.student_16_self_private, 'consent.revoke', consentTargetSelf(actors.student_16_self_private.account.id, 16), 'out_of_scope')
  })

  test('guardian.request_export', () => {
    expectAllow(actors.guardian_of_S, 'guardian.request_export', guardianResourceOf(CHILD_S))
    expectDeny(actors.no_membership, 'guardian.request_export', guardianResourceOf(CHILD_S), 'out_of_scope')
  })

  test('guardian.request_deletion', () => {
    expectAllow(actors.guardian_of_S, 'guardian.request_deletion', guardianResourceOf(CHILD_S))
    expectDeny(actors.no_membership, 'guardian.request_deletion', guardianResourceOf(CHILD_S), 'out_of_scope')
  })

  test('guardian.view_digest', () => {
    expectAllow(actors.guardian_of_S, 'guardian.view_digest', guardianResourceOf(CHILD_S))
    expectDeny(actors.no_membership, 'guardian.view_digest', guardianResourceOf(CHILD_S), 'out_of_scope')
  })

  test('application.view (ops back office, chapter-scoped)', () => {
    expectAllow(actors.chapter_director_c1, 'application.view', applicationInC1)
    expectDeny(actors.lead_instructor_c1, 'application.view', applicationInC1, 'role_not_permitted')
  })

  test('application.transition (ops back office, chapter-scoped write)', () => {
    expectAllow(actors.chapter_director_c1, 'application.transition', applicationInC1)
    expectDeny(actors.student_18, 'application.transition', applicationInC1, 'role_not_permitted')
  })

  test('lead.invite (Stage 2 start; staff invite a lead to apply, chapter-scoped write; chapter_director)', () => {
    expectAllow(actors.chapter_director_c1, 'lead.invite', leadInC1)
    expectDeny(actors.chapter_director_c2, 'lead.invite', leadInC1, 'out_of_scope')
    expectDeny(actors.lead_instructor_c1, 'lead.invite', leadInC1, 'role_not_permitted')
  })

  test('enrollment.create (coupling D, chapter-scoped ops write)', () => {
    expectAllow(actors.chapter_director_c1, 'enrollment.create', enrollmentInC1)
    expectDeny(actors.chapter_director_c2, 'enrollment.create', enrollmentInC1, 'out_of_scope')
    expectDeny(actors.lead_instructor_c1, 'enrollment.create', enrollmentInC1, 'role_not_permitted')
  })

  test('member.invite (ops invite issue/resend, chapter-scoped write; director or comms)', () => {
    expectAllow(actors.chapter_director_c1, 'member.invite', inviteInC1)
    expectAllow(actors.comms_associate_c1, 'member.invite', inviteInC1)
    expectDeny(actors.chapter_director_c2, 'member.invite', inviteInC1, 'out_of_scope')
    expectDeny(actors.lead_instructor_c1, 'member.invite', inviteInC1, 'role_not_permitted')
  })

  test('member.activate (Flow B step 3, couplings A+F, chapter-scoped write; chapter_director only)', () => {
    expectAllow(actors.chapter_director_c1, 'member.activate', membershipInC1)
    expectDeny(actors.chapter_director_c2, 'member.activate', membershipInC1, 'out_of_scope')
    expectDeny(actors.lead_instructor_c1, 'member.activate', membershipInC1, 'role_not_permitted')
    expectDeny(actors.comms_associate_c1, 'member.activate', membershipInC1, 'role_not_permitted')
  })

  test('guardianship.verify (Flow A step 6, chapter-scoped write; chapter_director only)', () => {
    expectAllow(actors.chapter_director_c1, 'guardianship.verify', guardianshipInC1)
    expectDeny(actors.chapter_director_c2, 'guardianship.verify', guardianshipInC1, 'out_of_scope')
    expectDeny(actors.lead_instructor_c1, 'guardianship.verify', guardianshipInC1, 'role_not_permitted')
  })

  test('dob.correct (audited correction, chapter-scoped write; director, or admin via platformGrant)', () => {
    expectAllow(actors.chapter_director_c1, 'dob.correct', dobCorrectInC1)
    expectAllow(actors.platform_admin, 'dob.correct', dobCorrectInC1) // platformGrant
    expectDeny(actors.chapter_director_c2, 'dob.correct', dobCorrectInC1, 'out_of_scope')
    expectDeny(actors.lead_instructor_c1, 'dob.correct', dobCorrectInC1, 'role_not_permitted')
  })

  test('deletion.review (ops review, chapter-scoped write; director, or admin via platformGrant)', () => {
    expectAllow(actors.chapter_director_c1, 'deletion.review', deletionRequestInC1)
    expectAllow(actors.platform_admin, 'deletion.review', deletionRequestInC1) // platformGrant
    expectDeny(actors.chapter_director_c2, 'deletion.review', deletionRequestInC1, 'out_of_scope')
    expectDeny(actors.lead_instructor_c1, 'deletion.review', deletionRequestInC1, 'role_not_permitted')
  })

  test('deletion.fulfill (tiered erase/redaction, chapter-scoped write; director only)', () => {
    expectAllow(actors.chapter_director_c1, 'deletion.fulfill', deletionRequestInC1)
    expectDeny(actors.chapter_director_c2, 'deletion.fulfill', deletionRequestInC1, 'out_of_scope')
    expectDeny(actors.lead_instructor_c1, 'deletion.fulfill', deletionRequestInC1, 'role_not_permitted')
    expectDeny(actors.student_18, 'deletion.fulfill', deletionRequestInC1, 'role_not_permitted')
  })

  test('export.fulfill (the review-right deliverable, chapter-scoped write; director only)', () => {
    expectAllow(actors.chapter_director_c1, 'export.fulfill', exportRequestInC1)
    expectDeny(actors.chapter_director_c2, 'export.fulfill', exportRequestInC1, 'out_of_scope')
    expectDeny(actors.lead_instructor_c1, 'export.fulfill', exportRequestInC1, 'role_not_permitted')
  })

  test('platform override does not clear subject consent (admin) but grants scope+role (staff read)', () => {
    // sanity: a read platform_staff can do via platformGrant
    expectAllow(actors.platform_staff, 'student.view_record', childRecordInPod)
  })

  test('senior_instructor resolves independently across its two pods', () => {
    expectAllow(actors.senior_instructor_c1, 'feed.moderate', postInPod1)
    expectAllow(actors.senior_instructor_c1, 'feed.moderate', postInPod2)
    expectDeny(actors.senior_instructor_c1, 'feed.moderate', postInC2, 'out_of_scope')
  })
})

// ===========================================================================
// Registry completeness meta-test (07-test-plan)
// ===========================================================================
describe('registry completeness', () => {
  test('every REGISTRY capability has at least one asserted allow', () => {
    const keys = Object.keys(REGISTRY)
    const missing = keys.filter((k) => !coverage.allow.has(k as never))
    expect(missing, `capabilities with no asserted ALLOW: ${missing.join(', ')}`).toEqual([])
  })

  test('every REGISTRY capability has at least one asserted deny', () => {
    const keys = Object.keys(REGISTRY)
    const missing = keys.filter((k) => !coverage.deny.has(k as never))
    expect(missing, `capabilities with no asserted DENY: ${missing.join(', ')}`).toEqual([])
  })

  test('every Role value appears as an actor fixture', () => {
    const seen = new Set<Role>()
    for (const ctx of ALL_FIXTURES) {
      for (const m of ctx.memberships) seen.add(m.role)
    }
    const missing = ALL_ROLES.filter((r) => !seen.has(r))
    expect(missing, `roles never used as an actor: ${missing.join(', ')}`).toEqual([])
  })
})
