import { expect } from 'vitest'
import {
  can,
  REGISTRY,
  ALL_ROLES,
  type AuthContext,
  type Capability,
  type ConsentSet,
  type Decision,
  type DenyReason,
  type Membership,
  type Resource,
  type Role,
} from '../src/index.js'

// ---------------------------------------------------------------------------
// Time. All timestamps are epoch-ms so `can` is a pure function of numbers.
// Fixtures use an obviously-synthetic instant so a real record in a test DB
// would stand out (per 07-test-plan test-data policy).
// ---------------------------------------------------------------------------
export const HOUR = 3_600_000
export const DAY = 86_400_000
export const YEAR = 365 * DAY
export const NOW = Date.UTC(2026, 6, 22, 12, 0, 0) // 2026-07-22T12:00:00Z

// ---------------------------------------------------------------------------
// Synthetic ids
// ---------------------------------------------------------------------------
export const C1 = 'chapter-C1'
export const C2 = 'chapter-C2'
export const PLATFORM = 'platform'
export const POD1 = 'pod-1'
export const POD2 = 'pod-2'
export const PODX = 'pod-X'

const ID = {
  platformAdmin: 'acct-platform-admin',
  platformStaff: 'acct-platform-staff',
  director1: 'acct-director-c1',
  director2: 'acct-director-c2',
  lead1: 'acct-lead-c1',
  senior1: 'acct-senior-c1',
  jmAdult: 'acct-jm-adult',
  jmMinor: 'acct-jm-minor',
  comms1: 'acct-comms-c1',
  sMinorConsented: 'acct-student-minor-consented',
  sMinorNoPart: 'acct-student-minor-no-part',
  s16: 'acct-student-16',
  s18: 'acct-student-18',
  alumni: 'acct-alumni',
  alumniMentor: 'acct-alumni-mentor',
  guardian: 'acct-guardian',
  guardianLapsed: 'acct-guardian-lapsed',
  noMembership: 'acct-no-membership',
  anonymous: 'acct-anonymous',
  suspended: 'acct-suspended',
  closed: 'acct-closed',
  expired: 'acct-expired-session',
  revoked: 'acct-revoked-session',
  imperMinor: 'acct-impersonated-minor',
  realActor: 'acct-real-actor',
  stale: 'acct-stale',
  multi: 'acct-multi-chapter',
  childS: 'acct-child-S',
  child18: 'acct-child-18',
  childInPod: 'acct-child-in-pod',
} as const

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------
function mem(
  role: Role,
  chapter: string,
  pod: string | null = null,
  opts: Partial<Membership> = {},
): Membership {
  return {
    chapter_id: chapter,
    role,
    status: 'active',
    pod_id: pod,
    tier: role === 'student' ? 'explorer' : null,
    active_from: NOW - YEAR,
    active_until: NOW + YEAR,
    ...opts,
  }
}

// unbounded (alumni / platform) memberships: no term window
function unbounded(m: Membership): Membership {
  return { ...m, active_from: null, active_until: null }
}

type CtxParts = {
  id: string
  age?: number
  status?: AuthContext['account']['status']
  maturation_state?: AuthContext['account']['maturation_state']
  credential_owner?: AuthContext['account']['credential_owner']
  session?: Partial<AuthContext['session']>
  memberships?: Membership[]
  guardianOf?: string[]
  consentsByChild?: Map<string, ConsentSet>
}

function ctx(p: CtxParts): AuthContext {
  return {
    now: NOW,
    account: {
      id: p.id,
      status: p.status ?? 'active',
      age: p.age ?? 30,
      maturation_state: p.maturation_state ?? 'self_managed',
      credential_owner: p.credential_owner ?? 'guardian_provisioned',
    },
    session: {
      mode: 'full',
      expires_at: NOW + HOUR,
      revoked_at: null,
      ...p.session,
    },
    memberships: p.memberships ?? [],
    guardianOf: p.guardianOf ?? [],
    consentsByChild: p.consentsByChild ?? new Map(),
  }
}

const consented = (id: string, set: ConsentSet): Map<string, ConsentSet> =>
  new Map([[id, set]])

// ---------------------------------------------------------------------------
// Actors — each a fully-formed AuthContext (07-test-plan fixtures)
// ---------------------------------------------------------------------------
export const actors = {
  platform_admin: ctx({
    id: ID.platformAdmin,
    memberships: [unbounded(mem('platform_admin', PLATFORM))],
  }),
  platform_staff: ctx({
    id: ID.platformStaff,
    memberships: [unbounded(mem('platform_staff', PLATFORM))],
  }),
  chapter_director_c1: ctx({
    id: ID.director1,
    memberships: [mem('chapter_director', C1)],
  }),
  chapter_director_c2: ctx({
    id: ID.director2,
    memberships: [mem('chapter_director', C2)],
  }),
  lead_instructor_c1: ctx({
    id: ID.lead1,
    memberships: [mem('lead_instructor', C1, POD1)],
  }),
  senior_instructor_c1: ctx({
    id: ID.senior1,
    memberships: [mem('senior_instructor', C1, POD1), mem('senior_instructor', C1, POD2)],
  }),
  junior_mentor_adult: ctx({
    id: ID.jmAdult,
    age: 20,
    memberships: [mem('junior_mentor', C1, POD1)],
  }),
  junior_mentor_minor: ctx({
    id: ID.jmMinor,
    age: 16,
    maturation_state: 'minor',
    memberships: [mem('junior_mentor', C1, POD1)],
    consentsByChild: consented(ID.jmMinor, { platform_participation: { active: true } }),
  }),
  comms_associate_c1: ctx({
    id: ID.comms1,
    memberships: [mem('comms_associate', C1)],
  }),
  student_minor_consented: ctx({
    id: ID.sMinorConsented,
    age: 15,
    maturation_state: 'minor',
    credential_owner: 'guardian_provisioned',
    memberships: [mem('student', C1, POD1)],
    consentsByChild: consented(ID.sMinorConsented, { platform_participation: { active: true } }),
  }),
  student_minor_no_participation: ctx({
    id: ID.sMinorNoPart,
    age: 15,
    maturation_state: 'minor',
    credential_owner: 'guardian_provisioned',
    memberships: [mem('student', C1, POD1)],
    consentsByChild: consented(ID.sMinorNoPart, { platform_participation: { active: false } }),
  }),
  student_16_self_private: ctx({
    id: ID.s16,
    age: 16,
    maturation_state: 'maturation_pending',
    credential_owner: 'self_private',
    memberships: [mem('student', C1, POD1)],
    consentsByChild: consented(ID.s16, { platform_participation: { active: true } }),
  }),
  student_18: ctx({
    id: ID.s18,
    age: 18,
    maturation_state: 'self_managed',
    memberships: [mem('student', C1, null)],
  }),
  alumni: ctx({
    id: ID.alumni,
    memberships: [unbounded(mem('alumni', C1))],
  }),
  alumni_with_active_mentor: ctx({
    id: ID.alumniMentor,
    age: 22,
    memberships: [unbounded(mem('alumni', C1)), mem('junior_mentor', C1, POD1)],
  }),
  guardian_of_S: ctx({
    id: ID.guardian,
    guardianOf: [ID.childS, ID.child18],
    consentsByChild: new Map([[ID.childS, {}]]),
  }),
  guardian_of_S_lapsed: ctx({
    id: ID.guardianLapsed,
    guardianOf: [], // lapse at coming-of-age removes the verified edge
  }),
  no_membership: ctx({ id: ID.noMembership }),
  anonymous: ctx({
    id: ID.anonymous,
    status: 'invited',
    session: { expires_at: NOW - HOUR },
  }),
  // must-not extras
  suspended: ctx({
    id: ID.suspended,
    status: 'suspended',
    memberships: [mem('student', C1, POD1)],
  }),
  closed: ctx({
    id: ID.closed,
    status: 'closed',
    memberships: [mem('student', C1, POD1)],
  }),
  expired_session: ctx({
    id: ID.expired,
    memberships: [mem('lead_instructor', C1, POD1)],
    session: { expires_at: NOW - 1 },
  }),
  revoked_session: ctx({
    id: ID.revoked,
    memberships: [mem('lead_instructor', C1, POD1)],
    session: { revoked_at: NOW - 1 },
  }),
  impersonation_minor_readonly: ctx({
    id: ID.imperMinor,
    age: 15,
    maturation_state: 'minor',
    memberships: [mem('student', C1, POD1)],
    consentsByChild: consented(ID.imperMinor, { platform_participation: { active: true } }),
    session: {
      mode: 'read_only',
      expires_at: NOW + 10 * 60_000,
      impersonation: {
        real_actor_account_id: ID.realActor,
        impersonated_account_id: ID.imperMinor,
      },
    },
  }),
  stale_student: ctx({
    id: ID.stale,
    age: 17,
    maturation_state: 'minor',
    memberships: [mem('student', C1, POD1, { active_until: NOW - DAY })],
    consentsByChild: consented(ID.stale, { platform_participation: { active: true } }),
  }),
  // one account, two memberships in different chapters/roles (must-not #1)
  multi_chapter_actor: ctx({
    id: ID.multi,
    age: 20,
    memberships: [mem('junior_mentor', C1, POD1), mem('student', C2, PODX)],
  }),
} satisfies Record<string, AuthContext>

export const ALL_FIXTURES: AuthContext[] = Object.values(actors)

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------
export const postInPod1: Resource = { id: 'post-1', chapter_id: C1, pod_id: POD1 }
export const postInPod2: Resource = { id: 'post-2', chapter_id: C1, pod_id: POD2 }
export const postInC2: Resource = { id: 'post-c2', chapter_id: C2, pod_id: PODX }
export const postChapterC1: Resource = { id: 'post-ch', chapter_id: C1, pod_id: null }

export const ISSUE_ID = 'issue-1'
export const issueNoItems: Resource = {
  id: ISSUE_ID,
  chapter_id: C1,
  studentAuthoredItems: [],
}
export const issueConsented: Resource = {
  id: ISSUE_ID,
  chapter_id: C1,
  studentAuthoredItems: [
    { student: ID.childS, consent: { external_publication: { active: true, scopeRef: ISSUE_ID } } },
  ],
}
export const issueUnconsented: Resource = {
  id: ISSUE_ID,
  chapter_id: C1,
  studentAuthoredItems: [
    { student: ID.childS, consent: { external_publication: { active: false } } },
  ],
}
export const issueMismatchedScope: Resource = {
  id: ISSUE_ID,
  chapter_id: C1,
  studentAuthoredItems: [
    {
      student: ID.childS,
      consent: { external_publication: { active: true, scopeRef: 'a-different-issue' } },
    },
  ],
}
export const issueSnapshotAbsent: Resource = {
  id: ISSUE_ID,
  chapter_id: C1,
  studentAuthoredItems: [{ student: ID.childS, consent: {} }],
}
export const platformIssueNoItems: Resource = {
  id: 'platform-issue',
  chapter_id: null,
  studentAuthoredItems: [],
}
export const platformIssueWithItem: Resource = {
  id: 'platform-issue-2',
  chapter_id: null,
  studentAuthoredItems: [
    { student: ID.childS, consent: { external_publication: { active: true, scopeRef: 'platform-issue-2' } } },
  ],
}

export const PROJECT_ID = 'project-1'
export const projectOwnedBy = (owner: string): Resource => ({
  id: PROJECT_ID,
  chapter_id: C1,
  pod_id: POD1,
  ownerAccountId: owner,
})
export const projectPublicConsented: Resource = {
  id: PROJECT_ID,
  chapter_id: C1,
  studentAuthoredItems: [
    { student: ID.s18, consent: { external_publication: { active: true, scopeRef: PROJECT_ID } } },
  ],
}
export const projectPublicUnconsented: Resource = {
  id: PROJECT_ID,
  chapter_id: C1,
  studentAuthoredItems: [
    { student: ID.s18, consent: { external_publication: { active: false } } },
  ],
}

// application funnel (ops back office) — chapter-scoped, no subject snapshot.
export const applicationInC1: Resource = { id: 'application-1', chapter_id: C1 }

// enrollment upload (coupling D) — chapter-scoped ops write, no subject snapshot.
export const enrollmentInC1: Resource = { id: 'enrollment-1', chapter_id: C1 }

// invite issue / resend (member.invite) — chapter-scoped ops write. The resource
// is the chapter the invite is issued into; no subject snapshot.
export const inviteInC1: Resource = { chapter_id: C1 }

// membership activation (member.activate; Flow B step 3, couplings A + F) —
// chapter-scoped ops write, Chapter Director. The resource is the membership
// being activated, scoped to its chapter; no subject consent snapshot (the
// enrollment-consent gate is a DB read in the service, not part of `can`).
export const membershipInC1: Resource = { id: 'membership-1', chapter_id: C1 }

// guardianship verify (Flow A step 6, the name-match authority floor) —
// chapter-scoped ops write, resolved against the enrolling chapter; no subject
// consent snapshot (verification precedes any digital consent).
export const guardianshipInC1: Resource = { id: 'guardianship-1', chapter_id: C1 }

// dob.correct (the audited mistyped-scan correction) — chapter-scoped ops write,
// resolved against the subject's enrolling chapter; the subject account is the
// resource. No consent snapshot (a factual correction, not a consent decision).
export const dobCorrectInC1: Resource = { id: 'acct-child-in-pod', chapter_id: C1 }

export const narrativeOwnedBy = (owner: string): Resource => ({
  id: 'narrative-1',
  chapter_id: C1,
  ownerAccountId: owner,
})
export const narrativeReviewC1: Resource = { id: 'narrative-1', chapter_id: C1 }

export const safetyReport: Resource = {
  id: 'report-safety',
  chapter_id: C1,
  pod_id: POD1,
  reportClass: 'safety',
}
export const ordinaryReport: Resource = {
  id: 'report-ordinary',
  chapter_id: C1,
  pod_id: POD1,
  reportClass: 'ordinary',
}

// child records (guardian + view_record)
export const childRecordOfS: Resource = {
  subjectAccountId: ID.childS,
  subjectAge: 15,
  subjectIsMinor: true,
  chapter_id: C1,
  pod_id: POD1,
  subjectPodId: POD1,
}
export const childRecordInPod: Resource = {
  subjectAccountId: ID.childInPod,
  subjectAge: 15,
  subjectIsMinor: true,
  chapter_id: C1,
  pod_id: POD1,
  subjectPodId: POD1,
}
export const childRecordOutOfPod: Resource = {
  subjectAccountId: ID.childInPod,
  subjectAge: 15,
  subjectIsMinor: true,
  chapter_id: C1,
  pod_id: POD2,
  subjectPodId: POD2,
}

// consent targets
export const consentTargetChildS: Resource = {
  subjectAccountId: ID.childS,
  subjectAge: 15,
}
export const consentTargetChild18: Resource = {
  subjectAccountId: ID.child18,
  subjectAge: 18,
  subjectIsMinor: false,
}
export const consentTargetSelf = (id: string, age: number): Resource => ({
  ownerAccountId: id,
  subjectAccountId: id,
  subjectAge: age,
})

// verification target
export const verificationTargetSelf = (id: string): Resource => ({
  ownerAccountId: id,
  subjectAccountId: id,
})

export const guardianResourceOf = (subject: string, age = 15): Resource => ({
  subjectAccountId: subject,
  subjectAge: age,
  subjectIsMinor: age < 18,
  subjectPodId: POD1,
  chapter_id: C1,
})

export const CHILD_S = ID.childS
export const CHILD_18 = ID.child18
export const OWNER_S18 = ID.s18

// ---------------------------------------------------------------------------
// Coverage recorder + assertion helpers.
// Every allow/deny asserted in the suite is recorded so the completeness
// meta-test can prove every REGISTRY key is exercised both ways.
// ---------------------------------------------------------------------------
export const coverage = {
  allow: new Set<Capability>(),
  deny: new Set<Capability>(),
}

function reasonOf(d: Decision): DenyReason | undefined {
  return d.allowed ? undefined : d.reason
}

export function expectAllow(
  actor: AuthContext,
  cap: Capability,
  res: Resource,
): Decision & { allowed: true } {
  const d = can(actor, cap, res)
  expect(
    d.allowed,
    `expected ${cap} to ALLOW for ${actor.account.id}, got deny ${reasonOf(d)}`,
  ).toBe(true)
  coverage.allow.add(cap)
  return d as Decision & { allowed: true }
}

export function expectDeny(
  actor: AuthContext,
  cap: Capability,
  res: Resource,
  reason?: DenyReason,
): Decision & { allowed: false } {
  const d = can(actor, cap, res)
  expect(d.allowed, `expected ${cap} to DENY for ${actor.account.id}`).toBe(false)
  if (reason !== undefined) {
    expect(reasonOf(d), `wrong deny reason for ${cap} / ${actor.account.id}`).toBe(reason)
  }
  coverage.deny.add(cap)
  return d as Decision & { allowed: false }
}

export { REGISTRY, ALL_ROLES }
export type { Capability, Role, AuthContext, Resource, Decision, DenyReason }
