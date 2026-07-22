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
  | 'newsletter.publish'
  | 'project.create'
  | 'project.submit'
  | 'project.verify'
  | 'project.publish_public'
  | 'profile.edit_narrative'
  | 'narrative.review'
  | 'verification.regenerate'
  | 'student.view_record'
  | 'guardian.view_child_record'
  | 'guardian.view_fee_status'
  | 'consent.grant'
  | 'consent.revoke'
  | 'guardian.request_export'
  | 'guardian.request_deletion'
  | 'guardian.view_digest'
