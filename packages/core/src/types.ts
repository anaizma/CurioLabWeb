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
  // Mentor-student DM Phase 1 (design C.1): a chapter-scoped INDEPENDENT safety
  // officer who reads every DM thread in their chapter and reviews/flags. It is
  // NOT a teaching role and NOT a student role — deliberately kept out of the
  // TEACHING set, the PARTICIPANTS set, and any mentor-eligibility logic. An
  // account cannot hold it in a chapter where it also holds a mentor/teaching or
  // student membership (the not-a-peer rule, enforced at assignment). It IS a
  // privileged (2FA-required) adult staff role.
  | 'safety_officer'

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
  'safety_officer',
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
  /**
   * Mentor-student DM Phase 1 (design Part B / C.14). Marks a PARTICIPANT DM
   * capability (dm.message / dm.read_own) as the fully-gated supervised-pair shape
   * — the def is only ever invoked behind `canDirectMessage` (pod assignment + a
   * current mentor_dm grant + mentor eligibility + the chapter switch + the global
   * MENTOR_DM_ENABLED flag). The no-direct-messaging guard reads this marker (with
   * the exact scope/roles shape) to admit ONLY these caps while still tripping for
   * any broader student-messaging shape. It authorizes NOTHING on its own.
   */
  pairGated?: boolean
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
  // attendance & make-up check-ins (guardian/director portal work order, Feature 2).
  // The guardian-submitted, staff-resolved attendance exception over a chapter
  // session (a kind='session' calendar event from Feature 1). attendance.submit is
  // the guardian-scoped WRITE (record an absent/late exception for the guardian's
  // own verified child; matched against ctx.guardianOf, like publication.object).
  // attendance.view_child is the guardian-scoped READ of that child's exceptions +
  // counts (writes:false, no logsRead — it returns attendance facts, not the
  // composed minor record). attendance.view is the chapter-scoped staff READ floor
  // (teaching roles: a director or that chapter's mentors; writes:false, so both
  // platform overrides reach it). attendance.resolve is the chapter-scoped staff
  // WRITE (a mentor/director marks the make-up check-in done — a distinct write cap
  // so a read-only platform_staff cannot complete a make-up).
  | 'attendance.submit'
  | 'attendance.view_child'
  | 'attendance.view'
  | 'attendance.resolve'
  // guardian <-> chapter-staff messaging (guardian/director portal work order,
  // Feature 3). Threaded, append-only messaging between a guardian and their
  // child's chapter's staff. message.send is the guardian-scoped WRITE (create a
  // thread or append to an existing own thread; matched against ctx.guardianOf,
  // writes:true so the age-18 bar applies). message.view_own is the guardian-scoped
  // READ of the guardian's OWN threads (writes:false, no logsRead — it returns the
  // guardian's own conversations, not the composed minor record). message.view is
  // the chapter-scoped staff READ floor (teaching roles: a director or that
  // chapter's mentors; writes:false, so both platform overrides reach it).
  // message.reply is the chapter-scoped staff WRITE (a mentor/director replies — a
  // distinct write cap so a read-only role cannot post).
  | 'message.send'
  | 'message.view_own'
  | 'message.view'
  | 'message.reply'
  // mentor-student direct messaging (design C.1, C.14; Phase 1, built DARK behind
  // MENTOR_DM_ENABLED, COUNSEL-GATED). safety_officer.assign is the director/admin
  // authority to name a chapter's independent safety officer (chapter-scoped write,
  // chapter_director; platform_admin via override; the not-a-peer rule is enforced
  // in the assignment service + a DB guard). dm.enable is the director/admin write
  // that flips the chapter DM switch on, refused unless the enable-preconditions
  // hold (a safety officer assigned, an insurance attestation recorded, ≥1
  // current-term pod). dm.message (the participant pair WRITE) and dm.read_own (the
  // participant pair READ) are the two `pairGated` PARTICIPANT caps a student may be
  // party to — the narrow no-direct-messaging exemption admits exactly these; every
  // invocation is additionally gated by `canDirectMessage`. dm.oversee is the safety
  // officer's chapter-wide read + flag review. NONE of these run while the flag is off.
  | 'safety_officer.assign'
  | 'dm.enable'
  | 'dm.message'
  | 'dm.read_own'
  | 'dm.oversee'
  // mentor-student DM Phase 4 (participant & guardian surfaces, design C.12; built
  // DARK). dm.report is the PARTICIPANT "something feels off" report-affordance: a
  // student (or a participant) files a low-stakes report that routes to the safety
  // officer and does NOT notify the mentor. Chapter-scoped write, the closed
  // participant floor {student} ∪ TEACHING, `pairGated` (the fully-gated
  // supervised-pair shape the no-direct-messaging guard admits) — a student IS a
  // party. The specific thread-party check + the safety-officer routing (no
  // mentor-visible signal) are DmParticipantService concerns on top of this floor.
  | 'dm.report'
  // mentor-student DM Phase 3 (detection & oversight, design C.7/C.8; built DARK).
  // dm.suspend_guardian_visibility is the safety officer's guarded, two-adult
  // suspension of a guardian's standing read access (chapter-scoped write,
  // [safety_officer]); the reason + second-adult-not-a-mentor + 90-day expiry +
  // reporter checkpoint are DmVisibilitySuspensionService concerns on top of this
  // floor. dm.acknowledge_visibility_suspension is the SECOND adult's
  // acknowledgement authority (chapter-scoped write, [chapter_director,
  // safety_officer] — never a mentor of the student; the distinct-from-initiator
  // + not-a-mentor rules are service-enforced). Both are staff-only (no student
  // party) and ride the existing guardian-staff exemption in the no-DM guard.
  | 'dm.suspend_guardian_visibility'
  | 'dm.acknowledge_visibility_suspension'
