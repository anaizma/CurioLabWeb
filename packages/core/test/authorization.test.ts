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
  projectPublicListed,
  narrativeOwnedBy,
  narrativeReviewC1,
  profileOwnedBy,
  applicationInC1,
  leadInC1,
  enrollmentInC1,
  inviteInC1,
  inviteAdminTarget,
  inviteDirectorC1,
  membershipInC1,
  guardianshipInC1,
  dobCorrectInC1,
  deletionRequestInC1,
  exportRequestInC1,
  maturationConfirmInC1,
  accountRecoverInC1,
  assistRecoveryInC1,
  ledgerReadC1,
  mentorEligibilityC1,
  calendarManageC1,
  calendarViewC1,
  guardianCalendarOfS,
  attendanceSubmitForS,
  attendanceSubmitFor18,
  attendanceViewChildOfS,
  attendanceViewC1,
  attendanceResolveC1,
  messageSendForS,
  messageSendFor18,
  messageViewOwnOfS,
  messageViewC1,
  messageReplyC1,
  dmChapterC1,
  childRecord18,
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
  impersonationTarget,
  auditChapterC1,
  safeguardTargetC1,
  chapterManageTarget,
  termInC1,
  podInC1,
  directorReadC1,
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

  // 04-state-machines "(none) -> draft | newsletter.draft | instructor, comms,
  // director": drafting is WIDE — an instructor (senior/lead) may draft, alongside
  // comms and the director. (Publishing is the narrow, director-only gate.)
  test('newsletter.draft (instructor, comms, or director may draft)', () => {
    expectAllow(actors.comms_associate_c1, 'newsletter.draft', issueNoItems)
    expectAllow(actors.lead_instructor_c1, 'newsletter.draft', issueNoItems)
    expectDeny(actors.student_18, 'newsletter.draft', issueNoItems, 'role_not_permitted')
  })

  test('newsletter.publish', () => {
    expectAllow(actors.chapter_director_c1, 'newsletter.publish', issueConsented)
    expectDeny(actors.chapter_director_c1, 'newsletter.publish', issueUnconsented, 'subject_consent_missing')
  })

  // 04-state-machines newsletter lifecycle (M3.5): the intermediate edges.
  //   - submit_review (draft -> in_review): the drafter (instructor/comms/director);
  //   - return (in_review -> draft, blocked -> in_review): the director only;
  //   - schedule (in_review -> scheduled, blocked -> scheduled): the director only;
  //   - unpublish (published -> archived): director, or admin via platformGrant.
  test('newsletter.submit_review (a drafter submits draft -> in_review)', () => {
    expectAllow(actors.comms_associate_c1, 'newsletter.submit_review', issueNoItems)
    expectAllow(actors.lead_instructor_c1, 'newsletter.submit_review', issueNoItems)
    expectDeny(actors.student_18, 'newsletter.submit_review', issueNoItems, 'role_not_permitted')
    expectDeny(actors.chapter_director_c2, 'newsletter.submit_review', issueNoItems, 'out_of_scope')
  })

  test('newsletter.return (only a director returns to draft)', () => {
    expectAllow(actors.chapter_director_c1, 'newsletter.return', issueNoItems)
    expectDeny(actors.lead_instructor_c1, 'newsletter.return', issueNoItems, 'role_not_permitted')
    expectDeny(actors.chapter_director_c2, 'newsletter.return', issueNoItems, 'out_of_scope')
  })

  test('newsletter.schedule (only a director schedules a send time)', () => {
    expectAllow(actors.chapter_director_c1, 'newsletter.schedule', issueNoItems)
    expectDeny(actors.comms_associate_c1, 'newsletter.schedule', issueNoItems, 'role_not_permitted')
    expectDeny(actors.chapter_director_c2, 'newsletter.schedule', issueNoItems, 'out_of_scope')
  })

  test('newsletter.unpublish (director, or admin via platformGrant; published -> archived)', () => {
    expectAllow(actors.chapter_director_c1, 'newsletter.unpublish', issueNoItems)
    expectAllow(actors.platform_admin, 'newsletter.unpublish', issueNoItems)
    expectDeny(actors.lead_instructor_c1, 'newsletter.unpublish', issueNoItems, 'role_not_permitted')
    expectDeny(actors.chapter_director_c2, 'newsletter.unpublish', issueNoItems, 'out_of_scope')
  })

  test('project.create (a student or an instructor may create; alumni may not)', () => {
    expectAllow(actors.student_18, 'project.create', { chapter_id: 'chapter-C1' })
    // 04-state-machines project "(none) -> draft | student (own), instructor".
    expectAllow(actors.lead_instructor_c1, 'project.create', { chapter_id: 'chapter-C1' })
    expectDeny(actors.alumni, 'project.create', { chapter_id: 'chapter-C1' }, 'role_not_permitted')
  })

  test('project.unpublish (director de-list; chapter-scoped write)', () => {
    expectAllow(actors.chapter_director_c1, 'project.unpublish', projectPublicListed)
    expectDeny(actors.chapter_director_c2, 'project.unpublish', projectPublicListed, 'out_of_scope')
    expectDeny(actors.lead_instructor_c1, 'project.unpublish', projectPublicListed, 'role_not_permitted')
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

  test('media.review (mentor/staff photo confirmation; pod|chapter TEACHING)', () => {
    // Same scope/roles as feed.moderate: a pod mentor or a chapter director may
    // confirm/clear/remove media; a student is not a reviewer.
    expectAllow(actors.lead_instructor_c1, 'media.review', postInPod1)
    expectAllow(actors.junior_mentor_minor, 'media.review', postInPod1)
    expectDeny(actors.student_18, 'media.review', postChapterC1, 'role_not_permitted')
  })

  test('profile.view (own scope: a member views their own profile)', () => {
    expectAllow(actors.student_18, 'profile.view', profileOwnedBy(actors.student_18.account.id))
    expectDeny(actors.student_18, 'profile.view', profileOwnedBy('someone-else'), 'out_of_scope')
  })

  test('profile.edit_narrative', () => {
    expectAllow(actors.student_18, 'profile.edit_narrative', narrativeOwnedBy(actors.student_18.account.id))
    expectDeny(actors.student_18, 'profile.edit_narrative', narrativeOwnedBy('someone-else'), 'out_of_scope')
  })

  test('narrative.review', () => {
    expectAllow(actors.chapter_director_c1, 'narrative.review', narrativeReviewC1)
    expectDeny(actors.student_minor_consented, 'narrative.review', narrativeReviewC1, 'role_not_permitted')
  })

  test('narrative.remove (staff moderation -> removed; chapter-scoped, reviewers)', () => {
    expectAllow(actors.lead_instructor_c1, 'narrative.remove', narrativeReviewC1)
    expectAllow(actors.chapter_director_c1, 'narrative.remove', narrativeReviewC1)
    expectDeny(actors.student_minor_consented, 'narrative.remove', narrativeReviewC1, 'role_not_permitted')
    expectDeny(actors.chapter_director_c2, 'narrative.remove', narrativeReviewC1, 'out_of_scope')
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

  // §5 consent GRANT ledger — the additive guardian-portal reads + the object
  // write. The reads (writes:false) resolve for the child's guardian and deny a
  // stranger out_of_scope; publication.object (writes:true) additionally bars an
  // 18+ child (guardian write authority ends at majority), like consent.revoke.
  test('guardian.list_children (§5 grant-portal read)', () => {
    expectAllow(actors.guardian_of_S, 'guardian.list_children', guardianResourceOf(CHILD_S))
    expectDeny(actors.no_membership, 'guardian.list_children', guardianResourceOf(CHILD_S), 'out_of_scope')
  })

  test('guardian.view_grants (§5 grant-portal read)', () => {
    expectAllow(actors.guardian_of_S, 'guardian.view_grants', guardianResourceOf(CHILD_S))
    expectDeny(actors.no_membership, 'guardian.view_grants', guardianResourceOf(CHILD_S), 'out_of_scope')
  })

  test('guardian.view_public_items (§5 grant-portal read)', () => {
    expectAllow(actors.guardian_of_S, 'guardian.view_public_items', guardianResourceOf(CHILD_S))
    expectDeny(actors.no_membership, 'guardian.view_public_items', guardianResourceOf(CHILD_S), 'out_of_scope')
  })

  test('publication.object (§5 notify-and-object withhold; guardian write)', () => {
    expectAllow(actors.guardian_of_S, 'publication.object', consentTargetChildS)
    expectDeny(actors.guardian_of_S, 'publication.object', consentTargetChild18, 'out_of_scope')
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

  // P2 §1: the two privileged-invite-kind authorities.
  // member.invite_admin — platform_admin's UNILATERAL authority to mint a
  // privileged (admin, or director-direct) invite. Platform-scoped, writes:true:
  // the platform_admin satisfies it via the override; a platform_staff (read-only
  // override) and any chapter director deny out_of_scope (a lone director cannot
  // mint a director invite directly).
  test('member.invite_admin (platform_admin only; staff + a chapter director deny out_of_scope)', () => {
    expectAllow(actors.platform_admin, 'member.invite_admin', inviteAdminTarget)
    expectDeny(actors.platform_staff, 'member.invite_admin', inviteAdminTarget, 'out_of_scope')
    expectDeny(actors.chapter_director_c1, 'member.invite_admin', inviteAdminTarget, 'out_of_scope')
  })

  // member.invite_director — the two-person director-invite flow. Chapter-scoped
  // [chapter_director]: a director in the chapter participates (two distinct ones
  // are required, enforced downstream), a platform_admin reaches it via the
  // override; another chapter denies out_of_scope, and a non-director role
  // (comms/instructor) denies role_not_permitted.
  test('member.invite_director (director or admin-override; comms denies; other chapter out_of_scope)', () => {
    expectAllow(actors.chapter_director_c1, 'member.invite_director', inviteDirectorC1)
    expectAllow(actors.platform_admin, 'member.invite_director', inviteDirectorC1)
    expectDeny(actors.chapter_director_c2, 'member.invite_director', inviteDirectorC1, 'out_of_scope')
    expectDeny(actors.comms_associate_c1, 'member.invite_director', inviteDirectorC1, 'role_not_permitted')
    expectDeny(actors.lead_instructor_c1, 'member.invite_director', inviteDirectorC1, 'role_not_permitted')
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

  // 04-state-machines account_maturation "maturation_pending -> self_managed |
  // maturation.confirm | chapter_director" (Flow D step 3). Chapter-scoped ops
  // write, Chapter Director; admin via platformGrant.
  test('maturation.confirm (Flow D step 3, chapter-scoped write; director, or admin via platformGrant)', () => {
    expectAllow(actors.chapter_director_c1, 'maturation.confirm', maturationConfirmInC1)
    expectAllow(actors.platform_admin, 'maturation.confirm', maturationConfirmInC1) // platformGrant
    expectDeny(actors.chapter_director_c2, 'maturation.confirm', maturationConfirmInC1, 'out_of_scope')
    expectDeny(actors.lead_instructor_c1, 'maturation.confirm', maturationConfirmInC1, 'role_not_permitted')
  })

  // 06-onboarding-flows Flow D step 4 (account.recover): the Chapter Director
  // reissues a setup token for a locked-out adult former student. Chapter-scoped
  // ops write, Chapter Director; admin via platformGrant.
  test('account.recover (Flow D step 4, chapter-scoped write; director, or admin via platformGrant)', () => {
    expectAllow(actors.chapter_director_c1, 'account.recover', accountRecoverInC1)
    expectAllow(actors.platform_admin, 'account.recover', accountRecoverInC1) // platformGrant
    expectDeny(actors.chapter_director_c2, 'account.recover', accountRecoverInC1, 'out_of_scope')
    expectDeny(actors.lead_instructor_c1, 'account.recover', accountRecoverInC1, 'role_not_permitted')
  })

  // The age-18 bar is on the guardian's consent WRITE authority, not on read
  // (04-state-machines: guardian read ends at the edge's `verified -> lapsed`, not
  // at the child's majority; 03-authorization "the guardian-consent-write bar at
  // 18"). A verified guardian still READS a just-turned-18 child's record through
  // maturation_pending; the same guardian may NOT write consent for them.
  test('guardian read persists at 18 (edge still verified); guardian consent write is barred at 18', () => {
    expectAllow(actors.guardian_of_S, 'guardian.view_child_record', childRecord18)
    expectAllow(actors.guardian_of_S, 'guardian.view_fee_status', childRecord18)
    expectDeny(actors.guardian_of_S, 'consent.grant', childRecord18, 'out_of_scope')
  })

  test('platform override does not clear subject consent (admin) but grants scope+role (staff read)', () => {
    // sanity: a read platform_staff can do via platformGrant
    expectAllow(actors.platform_staff, 'student.view_record', childRecordInPod)
  })

  // impersonation.start (05-api-surface `impersonation.start`, platform_admin
  // only). Scope 'platform', writes:true — the platform_admin satisfies it via the
  // override; the platform_staff read-only override does NOT (writes:true), so a
  // staff and any chapter actor deny out_of_scope.
  test('impersonation.start (platform_admin only; a write, so platform_staff and chapter actors deny)', () => {
    expectAllow(actors.platform_admin, 'impersonation.start', impersonationTarget)
    expectDeny(actors.platform_staff, 'impersonation.start', impersonationTarget, 'out_of_scope')
    expectDeny(actors.chapter_director_c1, 'impersonation.start', impersonationTarget, 'out_of_scope')
  })

  // audit.view (05-api-surface GET /ops/audit chapter-scoped; GET /admin/audit
  // global via the platform override). A director reads their own chapter; the
  // platform_admin reads any (global) via the override; another chapter denies
  // out_of_scope; a non-director role in the chapter denies role_not_permitted.
  test('audit.view (director for own chapter; admin global via override; other chapter out_of_scope)', () => {
    expectAllow(actors.chapter_director_c1, 'audit.view', auditChapterC1)
    expectAllow(actors.platform_admin, 'audit.view', auditChapterC1)
    expectDeny(actors.chapter_director_c2, 'audit.view', auditChapterC1, 'out_of_scope')
    expectDeny(actors.lead_instructor_c1, 'audit.view', auditChapterC1, 'role_not_permitted')
  })

  // guardianship.revoke (04-state-machines guardianship `verified -> revoked`,
  // actor director/admin). Chapter-scoped write; admin via the override.
  test('guardianship.revoke (director; admin via override; another chapter out_of_scope; non-director role_not_permitted)', () => {
    expectAllow(actors.chapter_director_c1, 'guardianship.revoke', guardianshipInC1)
    expectAllow(actors.platform_admin, 'guardianship.revoke', guardianshipInC1)
    expectDeny(actors.chapter_director_c2, 'guardianship.revoke', guardianshipInC1, 'out_of_scope')
    expectDeny(actors.lead_instructor_c1, 'guardianship.revoke', guardianshipInC1, 'role_not_permitted')
  })

  // consent.revoke_safeguarding (04-state-machines the safeguarding suspend; the
  // one sanctioned STAFF write to consent). Chapter-scoped write, chapter_director,
  // admin via override. It does NOT ride guardian/self scope, so a guardian denies
  // out_of_scope (no chapter membership to match).
  test('consent.revoke_safeguarding (director/admin only; a guardian cannot; a non-director denies role_not_permitted)', () => {
    expectAllow(actors.chapter_director_c1, 'consent.revoke_safeguarding', safeguardTargetC1)
    expectAllow(actors.platform_admin, 'consent.revoke_safeguarding', safeguardTargetC1)
    expectDeny(actors.chapter_director_c2, 'consent.revoke_safeguarding', safeguardTargetC1, 'out_of_scope')
    expectDeny(actors.guardian_of_S, 'consent.revoke_safeguarding', safeguardTargetC1, 'out_of_scope')
    expectDeny(actors.lead_instructor_c1, 'consent.revoke_safeguarding', safeguardTargetC1, 'role_not_permitted')
  })

  // ---- Platform administration (org structure) ----------------------------
  // chapter.manage (05-api-surface CRUD /admin/chapters, platform_admin only).
  // Scope 'platform', writes:true — the platform_admin satisfies it via the
  // override; the platform_staff read-only override does NOT (writes:true), so a
  // staff and any chapter director deny out_of_scope (platform scope, no role).
  test('chapter.manage (platform_admin only; staff and a director deny out_of_scope)', () => {
    expectAllow(actors.platform_admin, 'chapter.manage', chapterManageTarget)
    expectDeny(actors.platform_staff, 'chapter.manage', chapterManageTarget, 'out_of_scope')
    expectDeny(actors.chapter_director_c1, 'chapter.manage', chapterManageTarget, 'out_of_scope')
  })

  // term.manage (05-api-surface CRUD /admin/terms). Chapter-scoped write,
  // chapter_director; a director manages terms only in THEIR chapter (another
  // chapter denies out_of_scope); platform_admin manages any chapter via the
  // override; a non-director role in the chapter denies role_not_permitted.
  test('term.manage (director in own chapter; another chapter out_of_scope; admin via override)', () => {
    expectAllow(actors.chapter_director_c1, 'term.manage', termInC1)
    expectAllow(actors.platform_admin, 'term.manage', termInC1)
    expectDeny(actors.chapter_director_c2, 'term.manage', termInC1, 'out_of_scope')
    expectDeny(actors.lead_instructor_c1, 'term.manage', termInC1, 'role_not_permitted')
  })

  // pod.manage (05-api-surface CRUD /admin/pods). Same chapter-scoped director
  // shape as term.manage.
  test('pod.manage (director in own chapter; another chapter out_of_scope; admin via override)', () => {
    expectAllow(actors.chapter_director_c1, 'pod.manage', podInC1)
    expectAllow(actors.platform_admin, 'pod.manage', podInC1)
    expectDeny(actors.chapter_director_c2, 'pod.manage', podInC1, 'out_of_scope')
    expectDeny(actors.lead_instructor_c1, 'pod.manage', podInC1, 'role_not_permitted')
  })

  // director-portal READ surfaces (admin/director work order P1). Each is a
  // chapter-scoped read floored at chapter_director, writes:false — so a director
  // reads their OWN chapter, another chapter denies out_of_scope, a non-director
  // role denies role_not_permitted, and BOTH platform overrides (admin and the
  // read-only staff) reach it because it is a read.
  test('director-portal read capabilities (director own chapter; admin + staff via override; cross-chapter out_of_scope; non-director role_not_permitted)', () => {
    const reads = [
      'application.read',
      'invite.read',
      'membership.read',
      'guardianship.read',
      'enrollment.read',
      'pod.read',
      'deletion.read',
      'export.read',
    ] as const
    for (const cap of reads) {
      expectAllow(actors.chapter_director_c1, cap, directorReadC1)
      expectAllow(actors.platform_admin, cap, directorReadC1)
      // writes:false, so the read-only platform_staff override also grants it.
      expectAllow(actors.platform_staff, cap, directorReadC1)
      expectDeny(actors.chapter_director_c2, cap, directorReadC1, 'out_of_scope')
      expectDeny(actors.lead_instructor_c1, cap, directorReadC1, 'role_not_permitted')
    }
  })

  test('senior_instructor resolves independently across its two pods', () => {
    expectAllow(actors.senior_instructor_c1, 'feed.moderate', postInPod1)
    expectAllow(actors.senior_instructor_c1, 'feed.moderate', postInPod2)
    expectDeny(actors.senior_instructor_c1, 'feed.moderate', postInC2, 'out_of_scope')
  })
})

// ===========================================================================
// admin/director backend §8/§9: the new access-ledger + assisted-recovery caps
// ===========================================================================
describe('account.assist_recovery (§9 mentor/director-assisted minor recovery)', () => {
  test('a chapter mentor may assist recovery of a minor in their chapter', () => {
    expectAllow(actors.junior_mentor_adult, 'account.assist_recovery', assistRecoveryInC1)
  })
  test('the chapter director may assist recovery', () => {
    expectAllow(actors.chapter_director_c1, 'account.assist_recovery', assistRecoveryInC1)
  })
  test('platform_admin reaches it via the override', () => {
    expectAllow(actors.platform_admin, 'account.assist_recovery', assistRecoveryInC1)
  })
  test('a non-teaching role (comms) is denied (role_not_permitted)', () => {
    expectDeny(actors.comms_associate_c1, 'account.assist_recovery', assistRecoveryInC1, 'role_not_permitted')
  })
  test('a director in another chapter is denied (out_of_scope)', () => {
    expectDeny(actors.chapter_director_c2, 'account.assist_recovery', assistRecoveryInC1, 'out_of_scope')
  })
  test('platform_staff (read-only override) is denied a write cap (out_of_scope)', () => {
    expectDeny(actors.platform_staff, 'account.assist_recovery', assistRecoveryInC1, 'out_of_scope')
  })
})

describe('ledger.read (§8 append-only access-ledger read)', () => {
  test('the chapter director reads their own chapter ledger', () => {
    expectAllow(actors.chapter_director_c1, 'ledger.read', ledgerReadC1)
  })
  test('platform_staff reaches it via the read override (writes:false)', () => {
    expectAllow(actors.platform_staff, 'ledger.read', ledgerReadC1)
  })
  test('a director in another chapter is denied (out_of_scope)', () => {
    expectDeny(actors.chapter_director_c2, 'ledger.read', ledgerReadC1, 'out_of_scope')
  })
  test('a non-director role is denied (role_not_permitted)', () => {
    expectDeny(actors.comms_associate_c1, 'ledger.read', ledgerReadC1, 'role_not_permitted')
  })
})

// mentor.manage_eligibility (admin/director backend §6): the chapter-scoped write
// that records a mentor's eligibility clearances. Chapter_director in their own
// chapter (platform_admin via override); another chapter out_of_scope; a
// non-director role role_not_permitted; a read-only platform_staff out_of_scope
// (writes:true).
describe('mentor.manage_eligibility (§6 record a mentor eligibility clearance)', () => {
  test('the chapter director records eligibility in their own chapter', () => {
    expectAllow(actors.chapter_director_c1, 'mentor.manage_eligibility', mentorEligibilityC1)
  })
  test('platform_admin reaches it via the override', () => {
    expectAllow(actors.platform_admin, 'mentor.manage_eligibility', mentorEligibilityC1)
  })
  test('a director in another chapter is denied (out_of_scope)', () => {
    expectDeny(actors.chapter_director_c2, 'mentor.manage_eligibility', mentorEligibilityC1, 'out_of_scope')
  })
  test('a non-director role is denied (role_not_permitted)', () => {
    expectDeny(actors.lead_instructor_c1, 'mentor.manage_eligibility', mentorEligibilityC1, 'role_not_permitted')
  })
  test('a read-only platform_staff is denied a write cap (out_of_scope)', () => {
    expectDeny(actors.platform_staff, 'mentor.manage_eligibility', mentorEligibilityC1, 'out_of_scope')
  })
})

// ===========================================================================
// Shared chapter calendar (guardian/director portal, Feature 1): the three new
// capabilities.
//   - calendar.manage (chapter-scoped write, chapter_director; admin via override)
//   - calendar.view   (chapter-scoped read floor, TEACHING roles; both platform
//                       overrides reach it because writes:false)
//   - guardian.view_calendar (guardian-scoped read of the child's-chapter parent
//                       events; matched against ctx.guardianOf)
// ===========================================================================
describe('shared chapter calendar capabilities (Feature 1)', () => {
  test('calendar.manage (director writes own chapter; admin via override; cross-chapter out_of_scope; non-director role_not_permitted; read-only staff out_of_scope)', () => {
    expectAllow(actors.chapter_director_c1, 'calendar.manage', calendarManageC1)
    expectAllow(actors.platform_admin, 'calendar.manage', calendarManageC1)
    expectDeny(actors.chapter_director_c2, 'calendar.manage', calendarManageC1, 'out_of_scope')
    expectDeny(actors.lead_instructor_c1, 'calendar.manage', calendarManageC1, 'role_not_permitted')
    expectDeny(actors.platform_staff, 'calendar.manage', calendarManageC1, 'out_of_scope')
  })

  test('calendar.view (a mentor OR director in the chapter reads; both platform overrides reach it; cross-chapter out_of_scope; a student role_not_permitted)', () => {
    expectAllow(actors.junior_mentor_adult, 'calendar.view', calendarViewC1)
    expectAllow(actors.lead_instructor_c1, 'calendar.view', calendarViewC1)
    expectAllow(actors.chapter_director_c1, 'calendar.view', calendarViewC1)
    expectAllow(actors.platform_admin, 'calendar.view', calendarViewC1)
    // writes:false, so the read-only platform_staff override also grants it.
    expectAllow(actors.platform_staff, 'calendar.view', calendarViewC1)
    expectDeny(actors.chapter_director_c2, 'calendar.view', calendarViewC1, 'out_of_scope')
    expectDeny(actors.student_18, 'calendar.view', calendarViewC1, 'role_not_permitted')
  })

  test('guardian.view_calendar (the child’s guardian reads; a stranger denies out_of_scope)', () => {
    expectAllow(actors.guardian_of_S, 'guardian.view_calendar', guardianCalendarOfS)
    expectDeny(actors.no_membership, 'guardian.view_calendar', guardianCalendarOfS, 'out_of_scope')
  })
})

// ===========================================================================
// Attendance & make-up check-ins (guardian/director portal, Feature 2): the four
// new capabilities.
//   - attendance.submit     (guardian-scoped write; own verified child, barred at 18)
//   - attendance.view_child  (guardian-scoped read; persists past majority)
//   - attendance.view        (chapter-scoped staff read floor, TEACHING; both
//                             platform overrides reach it because writes:false)
//   - attendance.resolve     (chapter-scoped staff write, TEACHING; read-only
//                             platform_staff barred because writes:true)
// ===========================================================================
describe('attendance & make-up capabilities (Feature 2)', () => {
  test('attendance.submit (a guardian submits for their own verified minor child; a stranger out_of_scope; barred at 18)', () => {
    expectAllow(actors.guardian_of_S, 'attendance.submit', attendanceSubmitForS)
    expectDeny(actors.no_membership, 'attendance.submit', attendanceSubmitForS, 'out_of_scope')
    // writes:true, so the guardian write authority ends at the child's majority.
    expectDeny(actors.guardian_of_S, 'attendance.submit', attendanceSubmitFor18, 'out_of_scope')
  })

  test('attendance.view_child (the child’s guardian reads; a stranger out_of_scope)', () => {
    expectAllow(actors.guardian_of_S, 'attendance.view_child', attendanceViewChildOfS)
    expectDeny(actors.no_membership, 'attendance.view_child', attendanceViewChildOfS, 'out_of_scope')
  })

  test('attendance.view (a mentor OR director in the chapter reads the roster; both platform overrides reach it; cross-chapter out_of_scope; a student role_not_permitted)', () => {
    expectAllow(actors.junior_mentor_adult, 'attendance.view', attendanceViewC1)
    expectAllow(actors.chapter_director_c1, 'attendance.view', attendanceViewC1)
    expectAllow(actors.platform_admin, 'attendance.view', attendanceViewC1)
    // writes:false, so the read-only platform_staff override also grants it.
    expectAllow(actors.platform_staff, 'attendance.view', attendanceViewC1)
    expectDeny(actors.chapter_director_c2, 'attendance.view', attendanceViewC1, 'out_of_scope')
    expectDeny(actors.student_18, 'attendance.view', attendanceViewC1, 'role_not_permitted')
  })

  test('attendance.resolve (a mentor OR director completes a make-up; a read-only platform_staff barred; cross-chapter out_of_scope; a student role_not_permitted)', () => {
    expectAllow(actors.junior_mentor_adult, 'attendance.resolve', attendanceResolveC1)
    expectAllow(actors.chapter_director_c1, 'attendance.resolve', attendanceResolveC1)
    expectAllow(actors.platform_admin, 'attendance.resolve', attendanceResolveC1)
    // writes:true, so the read-only platform_staff override does NOT reach it.
    expectDeny(actors.platform_staff, 'attendance.resolve', attendanceResolveC1, 'out_of_scope')
    expectDeny(actors.chapter_director_c2, 'attendance.resolve', attendanceResolveC1, 'out_of_scope')
    expectDeny(actors.student_18, 'attendance.resolve', attendanceResolveC1, 'role_not_permitted')
  })
})

// ===========================================================================
// Guardian <-> chapter-staff messaging (guardian/director portal, Feature 3): the
// four new capabilities.
//   - message.send      (guardian-scoped write; own verified child, barred at 18)
//   - message.view_own   (guardian-scoped read of own threads; persists past majority)
//   - message.view       (chapter-scoped staff read floor, TEACHING; both platform
//                         overrides reach it because writes:false)
//   - message.reply      (chapter-scoped staff write, TEACHING; read-only
//                         platform_staff barred because writes:true)
// ===========================================================================
describe('guardian <-> chapter-staff messaging capabilities (Feature 3)', () => {
  test('message.send (a guardian sends for their own verified minor child; a stranger out_of_scope; barred at 18)', () => {
    expectAllow(actors.guardian_of_S, 'message.send', messageSendForS)
    expectDeny(actors.no_membership, 'message.send', messageSendForS, 'out_of_scope')
    // writes:true, so the guardian write authority ends at the child's majority.
    expectDeny(actors.guardian_of_S, 'message.send', messageSendFor18, 'out_of_scope')
  })

  test('message.view_own (the guardian reads their own threads; a stranger out_of_scope)', () => {
    expectAllow(actors.guardian_of_S, 'message.view_own', messageViewOwnOfS)
    expectDeny(actors.no_membership, 'message.view_own', messageViewOwnOfS, 'out_of_scope')
  })

  test('message.view (a mentor OR director in the chapter reads the threads; both platform overrides reach it; cross-chapter out_of_scope; a student role_not_permitted)', () => {
    expectAllow(actors.junior_mentor_adult, 'message.view', messageViewC1)
    expectAllow(actors.chapter_director_c1, 'message.view', messageViewC1)
    expectAllow(actors.platform_admin, 'message.view', messageViewC1)
    // writes:false, so the read-only platform_staff override also grants it.
    expectAllow(actors.platform_staff, 'message.view', messageViewC1)
    expectDeny(actors.chapter_director_c2, 'message.view', messageViewC1, 'out_of_scope')
    expectDeny(actors.student_18, 'message.view', messageViewC1, 'role_not_permitted')
  })

  test('message.reply (a mentor OR director replies; a read-only platform_staff barred; cross-chapter out_of_scope; a student role_not_permitted)', () => {
    expectAllow(actors.junior_mentor_adult, 'message.reply', messageReplyC1)
    expectAllow(actors.chapter_director_c1, 'message.reply', messageReplyC1)
    expectAllow(actors.platform_admin, 'message.reply', messageReplyC1)
    // writes:true, so the read-only platform_staff override does NOT reach it.
    expectDeny(actors.platform_staff, 'message.reply', messageReplyC1, 'out_of_scope')
    expectDeny(actors.chapter_director_c2, 'message.reply', messageReplyC1, 'out_of_scope')
    expectDeny(actors.student_18, 'message.reply', messageReplyC1, 'role_not_permitted')
  })
})

// ===========================================================================
// Mentor-student direct messaging (design C.1, C.14; Phase 1, built DARK behind
// MENTOR_DM_ENABLED). The five new capabilities' scope/role FLOORS. `can` gates
// only these floors; the specific mentor↔student pair, the four DM legs, the
// four-party read model, and the enable-preconditions are enforced by
// canDirectMessage + the DM services on top — so these tests assert the floor only.
// ===========================================================================
describe('mentor-student DM capabilities (Phase 1)', () => {
  test('safety_officer.assign (a director assigns; platform_admin via override; read-only staff barred; cross-chapter out_of_scope; non-director role_not_permitted)', () => {
    expectAllow(actors.chapter_director_c1, 'safety_officer.assign', dmChapterC1)
    expectAllow(actors.platform_admin, 'safety_officer.assign', dmChapterC1)
    expectDeny(actors.platform_staff, 'safety_officer.assign', dmChapterC1, 'out_of_scope')
    expectDeny(actors.chapter_director_c2, 'safety_officer.assign', dmChapterC1, 'out_of_scope')
    expectDeny(actors.junior_mentor_adult, 'safety_officer.assign', dmChapterC1, 'role_not_permitted')
  })

  test('dm.enable (a director flips the chapter switch; platform_admin via override; read-only staff barred; cross-chapter out_of_scope; non-director role_not_permitted)', () => {
    expectAllow(actors.chapter_director_c1, 'dm.enable', dmChapterC1)
    expectAllow(actors.platform_admin, 'dm.enable', dmChapterC1)
    expectDeny(actors.platform_staff, 'dm.enable', dmChapterC1, 'out_of_scope')
    expectDeny(actors.chapter_director_c2, 'dm.enable', dmChapterC1, 'out_of_scope')
    expectDeny(actors.junior_mentor_adult, 'dm.enable', dmChapterC1, 'role_not_permitted')
  })

  test('dm.message (a participant — student OR mentor in the chapter — may write; a safety officer is NOT a participant; cross-chapter out_of_scope; read-only override barred)', () => {
    expectAllow(actors.student_minor_consented, 'dm.message', dmChapterC1)
    expectAllow(actors.junior_mentor_adult, 'dm.message', dmChapterC1)
    // the safety officer is an overseer, not a participant writer.
    expectDeny(actors.safety_officer_c1, 'dm.message', dmChapterC1, 'role_not_permitted')
    expectDeny(actors.chapter_director_c2, 'dm.message', dmChapterC1, 'out_of_scope')
    // writes:true, so the read-only platform_staff override does NOT reach it.
    expectDeny(actors.platform_staff, 'dm.message', dmChapterC1, 'out_of_scope')
  })

  test('dm.read_own (either participant reads; both platform overrides reach it; a safety officer is not a participant; cross-chapter out_of_scope)', () => {
    expectAllow(actors.student_minor_consented, 'dm.read_own', dmChapterC1)
    expectAllow(actors.junior_mentor_adult, 'dm.read_own', dmChapterC1)
    // writes:false, so the read-only platform_staff override also grants it.
    expectAllow(actors.platform_staff, 'dm.read_own', dmChapterC1)
    expectDeny(actors.safety_officer_c1, 'dm.read_own', dmChapterC1, 'role_not_permitted')
    expectDeny(actors.chapter_director_c2, 'dm.read_own', dmChapterC1, 'out_of_scope')
  })

  test('dm.oversee (the safety officer reads + reviews their chapter; platform_admin via override; a mentor role_not_permitted; cross-chapter out_of_scope; read-only staff barred)', () => {
    expectAllow(actors.safety_officer_c1, 'dm.oversee', dmChapterC1)
    expectAllow(actors.platform_admin, 'dm.oversee', dmChapterC1)
    expectDeny(actors.junior_mentor_adult, 'dm.oversee', dmChapterC1, 'role_not_permitted')
    expectDeny(actors.safety_officer_c2, 'dm.oversee', dmChapterC1, 'out_of_scope')
    // writes:true, so the read-only platform_staff override does NOT reach it.
    expectDeny(actors.platform_staff, 'dm.oversee', dmChapterC1, 'out_of_scope')
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
