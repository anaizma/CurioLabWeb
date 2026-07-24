// -------------------------------------------------------------------------
// CurioLab platform core — authorization types.
//
// These are framework-agnostic. Nothing here imports from `next`, the app,
// or any IO. `can` is a pure function of the values declared below.
// -------------------------------------------------------------------------

export type Role =
  | 'platform_admin'
  | 'platform_staff'
  | 'chapter_director'
  | 'lead_instructor'
  | 'senior_instructor'
  | 'junior_mentor'
  | 'comms_associate'
  | 'student'
  | 'alumni'

export const ALL_ROLES: readonly Role[] = [
  'platform_admin',
  'platform_staff',
  'chapter_director',
  'lead_instructor',
  'senior_instructor',
  'junior_mentor',
  'comms_associate',
  'student',
  'alumni',
] as const

export type Scope = 'platform' | 'chapter' | 'pod' | 'own' | 'guardian'

export type ConsentType =
  | 'enrollment'
  | 'data_collection'
  | 'platform_participation'
  | 'public_profile'
  | 'photo_media'
  | 'external_publication'

export type AccountStatus = 'invited' | 'pending' | 'active' | 'suspended' | 'closed'
export type MaturationState = 'minor' | 'maturation_pending' | 'self_managed'
export type CredentialOwner = 'guardian_provisioned' | 'self_private'
export type MembershipStatus = 'pending' | 'active' | 'inactive' | 'offboarded' | 'suspended'
export type SessionMode = 'full' | 'read_only'
export type Tier = 'explorer' | 'builder' | 'innovator'

/** Epoch milliseconds. Kept as a plain number so `can` compares by value. */
export type Timestamp = number

export type AccountId = string
export type StudentId = string
export type ChapterId = string
export type PodId = string
export type Id = string

export interface ConsentState {
  active: boolean
  /** For scoped consents (e.g. external_publication scoped to an issue/project). */
  scopeRef?: string | null
}

export type ConsentSet = Partial<Record<ConsentType, ConsentState>>

/**
 * A membership carries an already-resolved in-force window. `active_from` /
 * `active_until` are resolved from the term (or the row overrides) upstream,
 * in the enrolling chapter's timezone. `null` means unbounded (e.g. alumni).
 */
export interface Membership {
  chapter_id: ChapterId
  role: Role
  status: MembershipStatus
  pod_id: PodId | null
  tier: Tier | null
  active_from: Timestamp | null
  active_until: Timestamp | null
  /**
   * §6 mentor eligibility (admin/director backend, REVIEW-GATED). For a teaching
   * membership, whether the mentor is CURRENTLY eligible (all four components
   * satisfied), hydrated by the context builder when enforcement is on. `false`
   * withdraws the student-facing capability set (see STUDENT_FACING_CAPABILITIES);
   * `true`/undefined never restricts. Read by `can` only when
   * `AuthContext.enforceMentorEligibility` is true — so with the flag off this
   * value is ignored and a mentor's access is unchanged.
   */
  mentorEligible?: boolean
}

export interface Impersonation {
  real_actor_account_id: AccountId
  impersonated_account_id: AccountId
}

export interface SessionContext {
  mode: SessionMode
  expires_at: Timestamp
  revoked_at: Timestamp | null
  impersonation?: Impersonation
}

export interface AccountContext {
  id: AccountId
  status: AccountStatus
  age: number
  maturation_state: MaturationState
  credential_owner: CredentialOwner
}

/**
 * Built once per request from indexed reads and passed by value into `can`.
 * Nothing downstream re-queries roles or consent.
 */
export interface AuthContext {
  now: Timestamp
  account: AccountContext
  session: SessionContext
  memberships: Membership[]
  /** Verified guardianship edges (children). Lapsed/revoked edges are absent. */
  guardianOf: StudentId[]
  /** Consent snapshots keyed by student. Also holds the actor's own consents. */
  consentsByChild: Map<StudentId, ConsentSet>
  /**
   * §6 REVIEW GATE. When true, `can` withdraws the student-facing capability set
   * from any teaching membership marked `mentorEligible: false`. Set only when the
   * app-layer flag MENTOR_ELIGIBILITY_ENFORCED is on; absent/false (the default,
   * production posture) means eligibility is recorded but never blocks — a mentor's
   * access is exactly as it is today until the legal flip.
   */
  enforceMentorEligibility?: boolean
}

/** A subject whose stored consent state travels on the resource snapshot. */
export interface StudentAuthoredItem {
  student: StudentId
  consent?: ConsentSet
}

/**
 * The resource is hydrated by the repository layer *before* `can` runs,
 * including any subject consent snapshot. A required field absent from the
 * resource fails closed (subject_consent_unknown), never passes by omission.
 */
export interface Resource {
  id?: Id
  chapter_id?: ChapterId | null
  pod_id?: PodId | null
  /** For 'own' scope: which account owns this resource. */
  ownerAccountId?: AccountId | null
  /** For 'guardian' scope: the student this resource concerns. */
  subjectAccountId?: StudentId | null
  /** The subject's age, used to bound guardian authority at majority. */
  subjectAge?: number | null
  subjectIsMinor?: boolean
  /** The subject's pod, for the "minor outside the actor's pod" read log. */
  subjectPodId?: PodId | null
  /** Subjects whose consent snapshot is required (newsletter items, a project). */
  studentAuthoredItems?: StudentAuthoredItem[]
  reportClass?: 'safety' | 'ordinary'
}

export interface SubjectConsentReq {
  student: StudentId
  type: ConsentType
  scopeRef?: Id
}

export interface CapabilityDef {
  /** Resolution tries each scope in order until one matches. */
  scope: Scope | Scope[]
  roles: Role[]
  /** Gates read-only impersonation mode. */
  writes: boolean
  /** e.g. age >= 18 for moderation.resolve. Not overridden by platformGrant. */
  actorCondition?: (ctx: AuthContext) => boolean
  /** Extra test for the 'own' scope, e.g. age >= 18 for a self consent grant. */
  ownCondition?: (ctx: AuthContext) => boolean
  /** Consent required OF THE ACTOR. No override branch. */
  actorConsent?: (ctx: AuthContext, resource: Resource) => ConsentType[]
  /** Consent required OF THE SUBJECT, read from the resource snapshot. */
  subjectConsent?: (resource: Resource) => SubjectConsentReq[]
  /** Emits a transactional minor_record.read obligation for out-of-pod minors. */
  logsRead?: boolean
}

export type Obligation = {
  type: 'minor_record.read' | (string & {})
  detail?: Record<string, unknown>
}

export type DenyReason =
  | 'account_not_active'
  | 'session_invalid'
  | 'impersonation_write_forbidden'
  | 'out_of_scope'
  | 'role_not_permitted'
  | 'actor_condition_failed'
  | 'actor_consent_missing'
  | 'subject_consent_unknown'
  | 'subject_consent_missing'

export type Decision =
  | { allowed: true; obligations: Obligation[] }
  | { allowed: false; reason: DenyReason; detail: Record<string, unknown> }

/**
 * The full set of capability keys. The registry is typed as
 * Record<Capability, CapabilityDef>, so adding a row to the union without a
 * registry entry (or vice versa) is a compile error.
 */
export type Capability =
  | 'feed.view'
  | 'feed.post'
  | 'feed.comment'
  | 'feed.react'
  | 'feed.report'
  | 'feed.moderate'
  | 'feed.hide_safety'
  | 'moderation.resolve'
  | 'newsletter.draft'
  | 'newsletter.submit_review'
  | 'newsletter.return'
  | 'newsletter.schedule'
  | 'newsletter.publish'
  | 'newsletter.unpublish'
  | 'project.create'
  | 'project.submit'
  | 'project.verify'
  | 'project.publish_public'
  | 'project.unpublish'
  | 'media.review'
  | 'application.view'
  | 'application.transition'
  | 'lead.invite'
  | 'enrollment.create'
  | 'member.invite'
  // P2 (admin/director backend §1): the per-kind issuing authority for the two
  // privileged invite kinds. member.invite_admin is platform-scoped
  // (platform_admin only) — a platform_admin's unilateral authority to mint an
  // `admin` invite, and to mint a `director` invite directly (a chapter_director
  // may NOT mint a director invite alone; they use the two-person flow).
  // member.invite_director is chapter-scoped [chapter_director] — the two-person
  // director-invite request + approve flow (a platform_admin reaches it via the
  // override, satisfying the "admin acting alone" path there too).
  | 'member.invite_admin'
  | 'member.invite_director'
  | 'member.activate'
  | 'guardianship.verify'
  | 'dob.correct'
  | 'profile.view'
  | 'profile.edit_narrative'
  | 'narrative.review'
  | 'narrative.remove'
  | 'verification.regenerate'
  | 'student.view_record'
  | 'guardian.view_child_record'
  | 'guardian.view_fee_status'
  | 'consent.grant'
  | 'consent.revoke'
  | 'guardian.request_export'
  | 'guardian.request_deletion'
  | 'guardian.view_digest'
  // ops deletion review + tiered fulfillment, and export fulfillment (M1 step 8)
  | 'deletion.review'
  | 'deletion.fulfill'
  | 'export.fulfill'
  // coming of age (M4): the Chapter Director confirms maturation, and recovers a
  // locked-out adult former student (Flow D steps 3 and 4)
  | 'maturation.confirm'
  | 'account.recover'
  // minor account recovery (admin/director backend §9): a logged, in-person
  // mentor/director-assisted recovery for a MINOR — distinct from account.recover
  // (the adult former-student reissue). Chapter-scoped, teaching roles, admin via
  // override; every use mints a setup token AND writes an access_ledger row.
  | 'account.assist_recovery'
  // platform back office (M1 HTTP-completion): impersonation start (platform_admin
  // only) and the audit-trail read (chapter for a director, global via the
  // platform override).
  | 'impersonation.start'
  | 'audit.view'
  // guardianship revoke (04-state-machines guardianship `verified -> revoked`) and
  // the safeguarding consent suspend (the one sanctioned staff write to consent).
  | 'guardianship.revoke'
  | 'consent.revoke_safeguarding'
  // platform administration (05-api-surface CRUD /admin/chapters, /admin/terms,
  // /admin/pods): standing up the org structure. chapter.manage is platform-scoped
  // (platform_admin only); term.manage and pod.manage are chapter-scoped, a
  // chapter_director managing their own chapter's terms and pods.
  | 'chapter.manage'
  | 'term.manage'
  | 'pod.manage'
  // director-portal READ surfaces (admin/director work order P1;
  // docs/platform/director-portal-read-endpoints.md). Each is a chapter-scoped,
  // read-only capability floored at chapter_director (platform_admin/-staff via
  // the read override): the director reads their own chapter's applications,
  // invites, roster, guardianships, enrollments, pods/terms, and the deletion /
  // export request queues. The media review queue reuses the existing
  // media.review. All writes:false, so platform_staff's read-only override reaches
  // them.
  | 'application.read'
  | 'invite.read'
  | 'membership.read'
  | 'guardianship.read'
  | 'enrollment.read'
  | 'pod.read'
  | 'deletion.read'
  | 'export.read'
  // the append-only invitation/access ledger read (admin/director backend §8):
  // a chapter-scoped, read-only surface floored at chapter_director (platform
  // overrides reach it), returning origination/access provenance with minor PII
  // hidden.
  | 'ledger.read'
  // consent GRANT ledger (admin/director backend §5). Grant CAPTURE reuses the
  // existing consent.grant, and per-grant REVOCATION the existing consent.revoke
  // (both guardian/own-scoped) — the grant ledger does not fork the consent write
  // authority. These are the ADDITIVE guardian-portal reads (the child list, the
  // per-child grant statuses, the child's public-surface items) and the
  // notify-and-object WITHHOLD write. All guardian-scoped; the reads are
  // writes:false (no logsRead — display names / already-public items only), and
  // publication.object is a guardian write that withholds one nominated item.
  | 'guardian.list_children'
  | 'guardian.view_grants'
  | 'guardian.view_public_items'
  | 'publication.object'
  // mentor eligibility as state (admin/director backend §6, REVIEW-GATED). The
  // ops/director authority to RECORD a mentor's eligibility component clearances
  // (background check, mandatory-reporter training, CWRU affiliation, code of
  // conduct). Chapter-scoped write, chapter_director; platform_admin via override.
  // The READ of a mentor's eligibility reuses the P1 `membership.read` roster read.
  | 'mentor.manage_eligibility'
  // shared chapter calendar (guardian/director portal work order, Feature 1). The
  // director-authored, audience-scoped chapter calendar. calendar.manage is the
  // chapter-scoped WRITE (create/edit/cancel; chapter_director, platform_admin via
  // override). calendar.view is the chapter-scoped staff READ floor (teaching roles:
  // a mentor sees mentor-audience events, a director sees all — the audience
  // refinement is a service concern on top of this role/scope floor; writes:false,
  // so both platform overrides reach it). guardian.view_calendar is the guardian-
  // scoped READ of the child's-chapter parent-audience events (like
  // guardian.view_digest), matched against ctx.guardianOf.
  | 'calendar.manage'
  | 'calendar.view'
  | 'guardian.view_calendar'
