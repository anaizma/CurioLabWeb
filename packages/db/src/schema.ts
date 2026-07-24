// -------------------------------------------------------------------------
// CurioLab platform — Milestone 0 Drizzle schema.
//
// This is the typed data-access projection of the entities in
// docs/platform/02-data-model.md. The compliance-critical guarantees (the DOB
// trigger, the form-sourced consent checks, evidence-backed tier, the single
// active membership index, append-only enforcement, consent_current
// maintenance, the impersonation-of-minor rule, the alumni shape, and the
// guardian-invite binding) are NOT expressible in a schema; they live in the
// raw SQL migrations under ./migrations and are exercised by the DB guarantee
// tests. This file gives the app a typed handle on the same tables.
// -------------------------------------------------------------------------

import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import {
  accountStatusEnum,
  applicationDraftPhaseEnum,
  applicationDraftStatusEnum,
  applicationKindEnum,
  applicationLeadFillerRoleEnum,
  applicationLeadStatusEnum,
  applicationStatusEnum,
  attendanceExceptionTypeEnum,
  calendarAudienceEnum,
  calendarEventKindEnum,
  calendarEventStatusEnum,
  makeupStatusEnum,
  messageSenderRoleEnum,
  chapterStatusEnum,
  chapterTierEnum,
  consentActionEnum,
  consentGrantMethodEnum,
  consentGrantTypeEnum,
  consentReasonEnum,
  consentSourceEnum,
  consentTypeEnum,
  contentStatusEnum,
  credentialOwnerEnum,
  credentialTokenPurposeEnum,
  deletionRequestStatusEnum,
  deletionScopeEnum,
  deliveryStatusEnum,
  dobProvenanceEnum,
  exportRequestStatusEnum,
  guardianshipStatusEnum,
  inviteKindEnum,
  inviteStatusEnum,
  maturationStateEnum,
  mediaReviewStatusEnum,
  mediaSourceEnum,
  membershipStatusEnum,
  mentorEligibilityComponentEnum,
  moderationActionEnum,
  moderationClassEnum,
  moderationReasonEnum,
  moderationTargetTypeEnum,
  narrativeStatusEnum,
  newsletterIssueStatusEnum,
  newsletterSubscriberDeliveryStatusEnum,
  paymentStatusEnum,
  postTypeEnum,
  projectStatusEnum,
  reactionTargetTypeEnum,
  relationshipEnum,
  roleEnum,
  sessionModeEnum,
  tierEnum,
  verificationMethodEnum,
} from './enums.js'

/** Postgres `citext` — case-insensitive text (emails, usernames). */
const citext = customType<{ data: string }>({
  dataType() {
    return 'citext'
  },
})

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

// --- Org structure ---------------------------------------------------------

export const chapter = pgTable('chapter', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  tier: chapterTierEnum('tier').notNull(),
  status: chapterStatusEnum('status').notNull(),
  timezone: text('timezone').notNull(),
  // Mentor-student DM Phase 2 (migration 0031): OPTIONAL per-chapter closed-hours
  // override of the config default window (07:00-21:00 local). NULL = use default.
  dmOpenHour: smallint('dm_open_hour'),
  dmCloseHour: smallint('dm_close_hour'),
  createdAt: createdAt(),
})

export const term = pgTable(
  'term',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => chapter.id),
    name: text('name').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('term_chapter_ends_idx').on(t.chapterId, t.endsOn)],
)

export const pod = pgTable('pod', {
  id: uuid('id').primaryKey().defaultRandom(),
  chapterId: uuid('chapter_id')
    .notNull()
    .references(() => chapter.id),
  termId: uuid('term_id')
    .notNull()
    .references(() => term.id),
  name: text('name').notNull(),
  // Circular with membership; resolved lazily and via ALTER in SQL migration.
  mentorMembershipId: uuid('mentor_membership_id').references(
    (): AnyPgColumn => membership.id,
  ),
  createdAt: createdAt(),
})

export const podAssignment = pgTable(
  'pod_assignment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => membership.id),
    podId: uuid('pod_id')
      .notNull()
      .references(() => pod.id),
    termId: uuid('term_id')
      .notNull()
      .references(() => term.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('pod_assignment_unique').on(t.membershipId, t.podId, t.termId),
  ],
)

// --- Core identity ---------------------------------------------------------

export const account = pgTable(
  'account',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: citext('email'),
    username: citext('username'),
    legalName: text('legal_name').notNull(),
    displayName: text('display_name').notNull(),
    dateOfBirth: date('date_of_birth').notNull(),
    dobProvenance: dobProvenanceEnum('dob_provenance').notNull(),
    dobSourceRef: uuid('dob_source_ref'),
    passwordHash: text('password_hash'),
    credentialOwner: credentialOwnerEnum('credential_owner').notNull(),
    status: accountStatusEnum('status').notNull(),
    maturationState: maturationStateEnum('maturation_state').notNull(),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    // §10 TOTP two-factor (migration 0023). The base32 shared secret (recoverable,
    // so stored not hashed — see the migration's at-rest note), the confirm stamp
    // (null = not active), and the replay-guard last-accepted time-step counter.
    totpSecret: text('totp_secret'),
    totpActivatedAt: timestamp('totp_activated_at', { withTimezone: true }),
    totpLastStep: bigint('totp_last_step', { mode: 'number' }),
  },
  (t) => [
    // Exactly one of email or username.
    check('account_identity_one_of', sql`(${t.email} is null) <> (${t.username} is null)`),
    uniqueIndex('account_email_unique').on(t.email).where(sql`${t.email} is not null`),
    uniqueIndex('account_username_unique')
      .on(t.username)
      .where(sql`${t.username} is not null`),
  ],
)

export const session = pgTable('session', {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenHash: text('token_hash').notNull().unique(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => account.id),
  mode: sessionModeEnum('mode').notNull(),
  impersonatedAccountId: uuid('impersonated_account_id').references(() => account.id),
  realActorAccountId: uuid('real_actor_account_id').references(() => account.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: createdAt(),
})

export const invite = pgTable('invite', {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenHash: text('token_hash').notNull(),
  kind: inviteKindEnum('kind').notNull(),
  targetEmail: citext('target_email'),
  intendedAccountId: uuid('intended_account_id').references(() => account.id),
  enrollmentRecordId: uuid('enrollment_record_id').references(() => enrollmentRecord.id),
  // The chapter the token is bound to at redemption (§4 token hardening). Adult
  // invites carry no enrollment record, so the chapter is recorded directly here;
  // acceptInvite verifies the presented {email, kind, chapter} against the row.
  boundChapterId: uuid('bound_chapter_id').references(() => chapter.id),
  issuedBy: uuid('issued_by')
    .notNull()
    .references(() => account.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  status: inviteStatusEnum('status').notNull(),
  deliveryStatus: deliveryStatusEnum('delivery_status').notNull(),
  createdAt: createdAt(),
})

// The two-person director-invite approval record (§1). A director INITIATES a
// pending request; a second, DISTINCT director APPROVES it, and only then is the
// director invite minted (invite_id stamped). Both actors + both timestamps are
// recorded; a DB CHECK enforces the distinct approver. See migration
// 0021_invite_kinds_and_binding.sql for the authoritative DDL + guarantees.
export const directorInviteRequest = pgTable('director_invite_request', {
  id: uuid('id').primaryKey().defaultRandom(),
  chapterId: uuid('chapter_id')
    .notNull()
    .references(() => chapter.id),
  targetEmail: citext('target_email').notNull(),
  initiatedBy: uuid('initiated_by')
    .notNull()
    .references(() => account.id),
  initiatedAt: timestamp('initiated_at', { withTimezone: true }).notNull().defaultNow(),
  approvedBy: uuid('approved_by').references(() => account.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  inviteId: uuid('invite_id').references(() => invite.id),
  status: text('status').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
})

// --- The funnel ------------------------------------------------------------

export const application = pgTable('application', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: applicationKindEnum('kind').notNull(),
  chapterId: uuid('chapter_id')
    .notNull()
    .references(() => chapter.id),
  status: applicationStatusEnum('status').notNull(),
  applicantName: text('applicant_name').notNull(),
  applicantContactEmail: citext('applicant_contact_email').notNull(),
  guardianName: text('guardian_name'),
  guardianEmail: citext('guardian_email'),
  guardianSignatureRef: uuid('guardian_signature_ref'),
  track: text('track'),
  githubUrl: text('github_url'),
  reopenedFromId: uuid('reopened_from_id').references((): AnyPgColumn => application.id),
  createdAt: createdAt(),
})

export const applicationEvent = pgTable('application_event', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id')
    .notNull()
    .references(() => application.id),
  fromStatus: applicationStatusEnum('from_status'),
  toStatus: applicationStatusEnum('to_status').notNull(),
  actorId: uuid('actor_id').references(() => account.id),
  note: text('note'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
})

// --- Application funnel v2 (Milestone 1 part A) ----------------------------
// Stage 1 lead capture and Stage 2 draft persistence. The lead holds ONLY a
// parent email/chapter/referral (no child data); the draft is populated by
// part B (the 2A/2B/2C flow) and created here as the table. See migration
// 0010_application_funnel.sql for the authoritative DDL.

export const applicationLead = pgTable(
  'application_lead',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: citext('email').notNull(),
    // The selected chapter CODE (design §7.1) — free text, not an fk, so
    // "interested in another school" (no chapter row) is expressible.
    chapter: text('chapter').notNull(),
    // Kept as the optional 2C linkage, populated when the code maps to a chapter.
    chapterId: uuid('chapter_id').references(() => chapter.id),
    // "How did you hear" — optional (design §7.1).
    source: text('source'),
    // Who filled Stage 1 (parent|student); drives the confirmation copy.
    fillerRole: applicationLeadFillerRoleEnum('filler_role').notNull(),
    status: applicationLeadStatusEnum('status').notNull().default('new'),
    // The Stage-2 token, issued at lead creation (forward-compat); consumed by Stage 2.
    tokenHash: text('token_hash'),
    convertedApplicationId: uuid('converted_application_id').references(() => application.id),
    // The design's conversion marker, set when a Stage-2 application submits at 2C.
    convertedAt: timestamp('converted_at', { withTimezone: true }),
    createdAt: createdAt(),
    // created_at + 30 days — the § 312.4(c)(1)(vii) retention/deletion floor.
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('application_lead_email_idx').on(t.email),
    index('application_lead_status_created_idx').on(t.status, t.createdAt),
  ],
)

export const applicationDraft = pgTable(
  'application_draft',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => applicationLead.id),
    parentTokenHash: text('parent_token_hash').notNull(),
    studentTokenHash: text('student_token_hash'),
    // The emailed 2C review-button token's hash (0020). Minted when the student
    // finishes 2B, superseded on each re-finish, cleared on send-back. The 2C ops
    // accept a token matching this OR parent_token_hash. Null until 2C is reached.
    reviewTokenHash: text('review_token_hash'),
    phase: applicationDraftPhaseEnum('phase').notNull(),
    parentAnswers: jsonb('parent_answers'),
    studentAnswers: jsonb('student_answers'),
    status: applicationDraftStatusEnum('status').notNull(),
    convertedApplicationId: uuid('converted_application_id').references(() => application.id),
    createdAt: createdAt(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
  },
  (t) => [index('application_draft_lead_idx').on(t.leadId)],
)

export const enrollmentRecord = pgTable('enrollment_record', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id')
    .notNull()
    .references(() => application.id),
  studentAccountId: uuid('student_account_id').references(() => account.id),
  chapterId: uuid('chapter_id')
    .notNull()
    .references(() => chapter.id),
  termId: uuid('term_id')
    .notNull()
    .references(() => term.id),
  signedFormRef: uuid('signed_form_ref').notNull(),
  guardianNameOnForm: text('guardian_name_on_form').notNull(),
  // The form's DOB, carried on the seeding enrollment (student_account_id null)
  // until the account is created at accept-student. Nullable; NOT NULL only when
  // student_account_id is null, and write-once — both enforced in the SQL
  // migrations (0005_enrollment_dob.sql / 0006_dob_write_once.sql), not here.
  dateOfBirth: date('date_of_birth'),
  // The date the guardian signed the paper enrollment/consent form. Set at
  // coupling D in both the seeding and returning cases; it is the effective_at
  // source for the two form-sourced consents. In the seeding case those consents
  // are created later (accept-student), so this value carries the temporal anchor
  // until then. Nullable, not write-once (0007_enrollment_form_signed_at.sql).
  formSignedAt: date('form_signed_at'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => account.id),
  createdAt: createdAt(),
})

// --- Standing and progression ----------------------------------------------

export const membership = pgTable(
  'membership',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id),
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => chapter.id),
    role: roleEnum('role').notNull(),
    status: membershipStatusEnum('status').notNull(),
    termId: uuid('term_id').references(() => term.id),
    activeFrom: date('active_from'),
    activeUntil: date('active_until'),
    podId: uuid('pod_id').references((): AnyPgColumn => pod.id),
    currentTier: tierEnum('current_tier'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('membership_single_active')
      .on(t.accountId, t.chapterId, t.role)
      .where(sql`${t.status} = 'active'`),
    index('membership_account_status_idx').on(t.accountId, t.status),
    // current_tier is a student-only concept.
    check('membership_tier_student_only', sql`${t.currentTier} is null or ${t.role} = 'student'`),
    // pod membership is for students and junior mentors only.
    check(
      'membership_pod_scope',
      sql`${t.podId} is null or ${t.role} in ('student', 'junior_mentor')`,
    ),
  ],
)

export const tierTransition = pgTable('tier_transition', {
  id: uuid('id').primaryKey().defaultRandom(),
  membershipId: uuid('membership_id')
    .notNull()
    .references(() => membership.id),
  fromTier: tierEnum('from_tier'),
  toTier: tierEnum('to_tier').notNull(),
  grantedBy: uuid('granted_by')
    .notNull()
    .references(() => account.id),
  evidenceRef: uuid('evidence_ref').notNull(),
  note: text('note'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
})

// --- Relationships ---------------------------------------------------------

export const guardianship = pgTable('guardianship', {
  id: uuid('id').primaryKey().defaultRandom(),
  guardianAccountId: uuid('guardian_account_id')
    .notNull()
    .references(() => account.id),
  studentAccountId: uuid('student_account_id')
    .notNull()
    .references(() => account.id),
  relationship: relationshipEnum('relationship').notNull(),
  status: guardianshipStatusEnum('status').notNull(),
  verificationMethod: verificationMethodEnum('verification_method').notNull(),
  verifiedBy: uuid('verified_by').references(() => account.id),
  sourceRef: uuid('source_ref'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  createdAt: createdAt(),
})

// --- Consent ---------------------------------------------------------------

export const consent = pgTable('consent', {
  id: uuid('id').primaryKey().defaultRandom(),
  seq: bigserial('seq', { mode: 'bigint' }).notNull().unique(),
  studentAccountId: uuid('student_account_id')
    .notNull()
    .references(() => account.id),
  type: consentTypeEnum('type').notNull(),
  action: consentActionEnum('action').notNull(),
  source: consentSourceEnum('source').notNull(),
  sourceRef: uuid('source_ref'),
  // The temporal anchor for a form-sourced grant (02-data-model.md): non-null
  // when source = 'signed_form'. effective_at is floored at the submission date
  // of the application reached through this enrollment record, not the record's
  // own created_at. Enforced in 0004_consent_temporal_rule.sql.
  enrollmentRecordId: uuid('enrollment_record_id').references(() => enrollmentRecord.id),
  scopeRef: uuid('scope_ref'),
  grantedBy: uuid('granted_by').references(() => account.id),
  effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
  reason: consentReasonEnum('reason').notNull(),
  createdAt: createdAt(),
})

export const consentCurrent = pgTable(
  'consent_current',
  {
    studentAccountId: uuid('student_account_id')
      .notNull()
      .references(() => account.id),
    type: consentTypeEnum('type').notNull(),
    consentId: uuid('consent_id')
      .notNull()
      .references(() => consent.id),
    active: boolean('active').notNull(),
    action: consentActionEnum('action').notNull(),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
    seq: bigint('seq', { mode: 'bigint' }).notNull(),
    sourceRef: uuid('source_ref'),
    scopeRef: uuid('scope_ref'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.studentAccountId, t.type] })],
)

// --- Consent GRANT ledger (admin/director backend §5) ----------------------
// The append-only, per-practice grant ledger (migration 0024). A PEER of the
// `consent` block ledger, never a replacement: six independent grant types, each
// captured in one guardian sitting but its own row so it expires, renews, and
// revokes on its own clock. A revocation or renewal is a NEW row (append-only:
// reject_append_only_mutation() + role REVOKE). The under-13 public_publication
// strong-method floor is a DB trigger. The DDL + guarantees live in migration
// 0024, not here. This whole surface is gated behind CONSENT_GRANT_LEDGER_ENFORCED
// (default off) until legal review.
export const consentGrant = pgTable(
  'consent_grant',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seq: bigserial('seq', { mode: 'bigint' }).notNull().unique(),
    grantType: consentGrantTypeEnum('grant_type').notNull(),
    subjectStudentAccountId: uuid('subject_student_account_id')
      .notNull()
      .references(() => account.id),
    guardianAccountId: uuid('guardian_account_id').references(() => account.id),
    scope: text('scope'),
    method: consentGrantMethodEnum('method').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    evidenceArtifactRef: text('evidence_artifact_ref'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by').references(() => account.id),
    createdAt: createdAt(),
  },
  (t) => [index('consent_grant_subject_type_idx').on(t.subjectStudentAccountId, t.grantType, t.seq)],
)

// The notify-and-object hold (migration 0024). A mutable work table (object
// stamps objected_at, release stamps released_at), so NOT append-only.
export const publicationHold = pgTable(
  'publication_hold',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    itemType: text('item_type').notNull(),
    itemRef: text('item_ref').notNull(),
    subjectStudentAccountId: uuid('subject_student_account_id')
      .notNull()
      .references(() => account.id),
    guardianAccountId: uuid('guardian_account_id').references(() => account.id),
    nominatedAt: timestamp('nominated_at', { withTimezone: true }).notNull().defaultNow(),
    releasesAt: timestamp('releases_at', { withTimezone: true }).notNull(),
    objectedAt: timestamp('objected_at', { withTimezone: true }),
    objectedBy: uuid('objected_by').references(() => account.id),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('publication_hold_subject_idx').on(t.subjectStudentAccountId)],
)

// --- Mentor eligibility as state (admin/director backend §6) ----------------
// Append-only clearance ledger (migration 0025). One row per (membership,
// component) clearance EVENT; a renewal is a NEW row, a lapse is expiry. The
// current status per (membership, component) is the mentor_eligibility_current
// view (not modeled here). Append-only via the reject_append_only_mutation()
// trigger + role REVOKE. Gated behind MENTOR_ELIGIBILITY_ENFORCED until legal
// review.
export const mentorEligibility = pgTable(
  'mentor_eligibility',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seq: bigserial('seq', { mode: 'bigint' }).notNull().unique(),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => membership.id),
    component: mentorEligibilityComponentEnum('component').notNull(),
    clearedAt: timestamp('cleared_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    version: text('version'),
    evidenceRef: text('evidence_ref'),
    recordedBy: uuid('recorded_by').references(() => account.id),
    createdAt: createdAt(),
  },
  (t) => [index('mentor_eligibility_membership_component_idx').on(t.membershipId, t.component, t.seq)],
)

// --- Shared chapter calendar (guardian/director portal, Feature 1) ----------
// The director-authored, audience-scoped chapter calendar as an append-only
// revision log (migration 0026). One row per (event, revision): a stable event_id
// identity, a bumped version, a status (active|canceled), and the full field
// snapshot including the audiences[] enum array. An edit is a new active revision,
// a cancel a new 'canceled' tombstone — never a mutation (append-only via the
// reject_append_only_mutation() trigger + role REVOKE). The current state per event
// is the calendar_event_current view (not modeled here). The DDL + guarantees live
// in migration 0026, not here.
export const calendarEvent = pgTable(
  'calendar_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seq: bigserial('seq', { mode: 'bigint' }).notNull().unique(),
    eventId: uuid('event_id').notNull(),
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => chapter.id),
    version: integer('version').notNull().default(1),
    status: calendarEventStatusEnum('status').notNull().default('active'),
    title: text('title').notNull(),
    kind: calendarEventKindEnum('kind').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    audiences: calendarAudienceEnum('audiences').array().notNull(),
    location: text('location'),
    notes: text('notes'),
    createdByAccountId: uuid('created_by_account_id').references(() => account.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('calendar_event_event_seq_idx').on(t.eventId, t.seq),
    index('calendar_event_chapter_idx').on(t.chapterId, t.seq),
    check('calendar_event_time_order', sql`${t.endsAt} > ${t.startsAt}`),
    check('calendar_event_audiences_nonempty', sql`cardinality(${t.audiences}) >= 1`),
  ],
)

// --- Attendance & make-up check-ins (guardian/director portal, Feature 2) ---
// The guardian-submitted, staff-resolved attendance exception as an append-only
// revision log (migration 0027). One row per (exception, revision): a stable
// exception_id identity, a bumped version, a type (absent|late), and the full
// snapshot including makeup_slots[]. A make-up COMPLETION is a new revision
// (makeup_status -> 'completed') — never a mutation (append-only via the
// reject_append_only_mutation() trigger + role REVOKE). The current state per
// exception is the attendance_exception_current view (not modeled here).
// session_event_id references the calendar SESSION's stable event_id (logical, not
// a FK — event_id is not unique). The DDL + guarantees live in migration 0027.
export const attendanceException = pgTable(
  'attendance_exception',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seq: bigserial('seq', { mode: 'bigint' }).notNull().unique(),
    exceptionId: uuid('exception_id').notNull(),
    studentAccountId: uuid('student_account_id')
      .notNull()
      .references(() => account.id),
    sessionEventId: uuid('session_event_id').notNull(),
    version: integer('version').notNull().default(1),
    type: attendanceExceptionTypeEnum('type').notNull(),
    reason: text('reason'),
    arriveAt: timestamp('arrive_at', { withTimezone: true }),
    makeupConsent: boolean('makeup_consent').notNull().default(false),
    makeupSlots: timestamp('makeup_slots', { withTimezone: true }).array().notNull().default([]),
    makeupStatus: makeupStatusEnum('makeup_status'),
    createdByGuardianAccountId: uuid('created_by_guardian_account_id')
      .notNull()
      .references(() => account.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('attendance_exception_exc_seq_idx').on(t.exceptionId, t.seq),
    index('attendance_exception_student_seq_idx').on(t.studentAccountId, t.seq),
    index('attendance_exception_session_idx').on(t.sessionEventId, t.seq),
    check(
      'attendance_late_no_makeup',
      sql`${t.type} <> 'late' OR (${t.makeupStatus} IS NULL AND cardinality(${t.makeupSlots}) = 0)`,
    ),
    check(
      'attendance_absent_has_status',
      sql`${t.type} <> 'absent' OR ${t.makeupStatus} IS NOT NULL`,
    ),
  ],
)

// --- Guardian <-> chapter-staff messaging (guardian/director portal, Feature 3) ---
// Threaded, append-only messaging (migration 0028), retained like email. A
// message_thread is INSERT-once (its columns never mutate); a message is
// append-only (a correction is a new row) — both guarded by the shared
// reject_append_only_mutation() trigger + SELECT/INSERT-only role grants.
// `last_message_at` is NOT a stored column: it is DERIVED by the
// message_thread_current view as max(sent_at) (not modeled here). The DDL +
// guarantees live in migration 0028, not here.
export const messageThread = pgTable(
  'message_thread',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => chapter.id),
    guardianAccountId: uuid('guardian_account_id')
      .notNull()
      .references(() => account.id),
    subject: text('subject'),
    createdAt: createdAt(),
  },
  (t) => [
    index('message_thread_guardian_idx').on(t.guardianAccountId),
    index('message_thread_chapter_idx').on(t.chapterId),
  ],
)

export const message = pgTable(
  'message',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seq: bigserial('seq', { mode: 'bigint' }).notNull().unique(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => messageThread.id),
    senderAccountId: uuid('sender_account_id')
      .notNull()
      .references(() => account.id),
    senderRole: messageSenderRoleEnum('sender_role').notNull(),
    body: text('body').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('message_thread_seq_idx').on(t.threadId, t.seq)],
)

// --- Mentor-student direct messaging (Phase 1, migration 0030; built DARK) ---
// The append-only, ENCRYPTED four-party thread store. dm_message.body is an
// AES-256-GCM {v,iv,ct,tag} envelope (packages/runtime field-crypto.ts), NEVER
// plaintext (a DB CHECK enforces the envelope keys). Both tables are append-only
// (the shared reject_append_only_mutation trigger + SELECT/INSERT-only grants).
// last_message_at is DERIVED by the dm_thread_current view (not a stored column).
export const dmThread = pgTable(
  'dm_thread',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => chapter.id),
    mentorMembershipId: uuid('mentor_membership_id')
      .notNull()
      .references(() => membership.id),
    studentAccountId: uuid('student_account_id')
      .notNull()
      .references(() => account.id),
    visibilityHeaderVersion: text('visibility_header_version').notNull(),
    visibilityHeaderText: text('visibility_header_text').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('dm_thread_chapter_idx').on(t.chapterId),
    index('dm_thread_mentor_idx').on(t.mentorMembershipId),
    index('dm_thread_student_idx').on(t.studentAccountId),
    uniqueIndex('dm_thread_pair_unique').on(t.mentorMembershipId, t.studentAccountId),
  ],
)

export const dmMessage = pgTable(
  'dm_message',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seq: bigserial('seq', { mode: 'bigint' }).notNull().unique(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => dmThread.id),
    senderAccountId: uuid('sender_account_id')
      .notNull()
      .references(() => account.id),
    // The AES-256-GCM {v, iv, ct, tag} envelope — never plaintext at rest.
    body: jsonb('body').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('dm_message_thread_seq_idx').on(t.threadId, t.seq),
    check('dm_message_body_encrypted', sql`${t.body} ?& array['v','iv','ct','tag']`),
  ],
)

// Part D enable-precondition records (append-only). An insurance attestation for a
// chapter, and the chapter DM switch (one row per chapter = "on").
export const dmInsuranceAttestation = pgTable(
  'dm_insurance_attestation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => chapter.id),
    carrier: text('carrier'),
    policyRef: text('policy_ref'),
    attestedBy: uuid('attested_by')
      .notNull()
      .references(() => account.id),
    attestedAt: timestamp('attested_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index('dm_insurance_attestation_chapter_idx').on(t.chapterId)],
)

export const dmChapterSwitch = pgTable(
  'dm_chapter_switch',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => chapter.id),
    enabledBy: uuid('enabled_by')
      .notNull()
      .references(() => account.id),
    enabledAt: timestamp('enabled_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('dm_chapter_switch_chapter_unique').on(t.chapterId)],
)

// --- Mentor-student DM Phase 2 (migration 0031; built DARK) -----------------
// The append-only content-flag record (design C.5). A send whose plaintext body
// matches a content matcher (Phase 2: contact-info) records a flag routed to the
// safety officer. `detail` is the matched KIND (e.g. 'email'), never the raw
// plaintext match (the body is encrypted at rest). Append-only (shared trigger +
// SELECT/INSERT-only grants), like dm_thread/dm_message.
export const dmFlag = pgTable(
  'dm_flag',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => dmThread.id),
    messageId: uuid('message_id')
      .notNull()
      .references(() => dmMessage.id),
    category: text('category').notNull(),
    detail: text('detail'),
    createdAt: createdAt(),
  },
  (t) => [
    index('dm_flag_thread_idx').on(t.threadId, t.createdAt),
    index('dm_flag_message_idx').on(t.messageId),
    index('dm_flag_category_idx').on(t.category),
  ],
)

// --- Mentor-student DM Phase 3 (detection & oversight, migration 0032; DARK) ---
// All four are APPEND-ONLY (shared reject_append_only_mutation trigger +
// SELECT/INSERT-only grants), like dm_thread/dm_message/dm_flag.

// dm_read_receipt (C.6): a reader (the safety officer) marking a thread read up to
// a `seq`. Coverage is COMPUTED (a message is read iff seq <= max up_to_seq).
export const dmReadReceipt = pgTable(
  'dm_read_receipt',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => dmThread.id),
    readerAccountId: uuid('reader_account_id')
      .notNull()
      .references(() => account.id),
    upToSeq: bigint('up_to_seq', { mode: 'bigint' }).notNull(),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    index('dm_read_receipt_thread_idx').on(t.threadId, t.upToSeq),
    index('dm_read_receipt_reader_idx').on(t.readerAccountId),
  ],
)

// dm_flag_review (C.7): the safety officer's disposition of a raised dm_flag. A
// review is a NEW record (dm_flag is append-only). `note` is a reference, not PII.
export const dmFlagReview = pgTable(
  'dm_flag_review',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    flagId: uuid('flag_id')
      .notNull()
      .references(() => dmFlag.id),
    reviewedBy: uuid('reviewed_by')
      .notNull()
      .references(() => account.id),
    disposition: text('disposition').notNull(),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [index('dm_flag_review_flag_idx').on(t.flagId)],
)

// dm_visibility_suspension (C.8): the two-adult guardian-visibility suspension,
// EVENT-SOURCED as append-only lifecycle rows grouped by suspension_id
// (initiated -> acknowledged -> revoked). "Active" is computed by the service. A
// CHECK requires an initiation to carry its reason + initiator + expiry.
export const dmVisibilitySuspension = pgTable(
  'dm_visibility_suspension',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    event: text('event').notNull(),
    suspensionId: uuid('suspension_id').notNull(),
    studentAccountId: uuid('student_account_id')
      .notNull()
      .references(() => account.id),
    threadId: uuid('thread_id').references(() => dmThread.id),
    initiatedBySafetyOfficerId: uuid('initiated_by_safety_officer_id').references(() => account.id),
    reason: text('reason'),
    secondAdultAccountId: uuid('second_adult_account_id').references(() => account.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    reporterCheckpointAck: boolean('reporter_checkpoint_ack').notNull().default(false),
    actorAccountId: uuid('actor_account_id').references(() => account.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('dm_visibility_suspension_student_idx').on(t.studentAccountId),
    index('dm_visibility_suspension_group_idx').on(t.suspensionId, t.event),
    check('event', sql`${t.event} IN ('initiated','acknowledged','revoked')`),
    check(
      'dm_visibility_suspension_initiated_requires_reason',
      sql`${t.event} <> 'initiated' OR (${t.reason} IS NOT NULL AND ${t.initiatedBySafetyOfficerId} IS NOT NULL AND ${t.expiresAt} IS NOT NULL)`,
    ),
  ],
)

// dm_thread_freeze (C.15): the mentor-departure freeze/preserve record. A thread
// is FROZEN iff a row exists (one per thread). handoff_decision is REQUIRED.
export const dmThreadFreeze = pgTable(
  'dm_thread_freeze',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => dmThread.id),
    mentorMembershipId: uuid('mentor_membership_id')
      .notNull()
      .references(() => membership.id),
    reason: text('reason'),
    handoffDecision: text('handoff_decision').notNull(),
    frozenByAccountId: uuid('frozen_by_account_id').references(() => account.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('dm_thread_freeze_thread_unique').on(t.threadId)],
)

// --- Audit -----------------------------------------------------------------

export const auditEntry = pgTable(
  'audit_entry',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    actorAccountId: uuid('actor_account_id').references(() => account.id),
    realActorAccountId: uuid('real_actor_account_id').references(() => account.id),
    action: text('action').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id'),
    chapterId: uuid('chapter_id').references(() => chapter.id),
    detail: jsonb('detail').notNull().default({}),
  },
  (t) => [
    index('audit_subject_idx').on(t.subjectType, t.subjectId, t.at),
    index('audit_actor_idx').on(t.actorAccountId, t.at),
  ],
)

// --- Access ledger (admin/director backend §8) -----------------------------
// The append-only invitation/access-provenance record: who invited whom, the
// token issuance, the redemption (with the client IP), the consent artifact +
// method referenced at accept-student, membership activation, and mentor-assisted
// credential resets. A PEER of audit_entry (the authorization decision log), not
// an extension — it carries columns audit_entry does not (client_ip, target_email,
// invite_kind, consent_ref/method) and its own read capability. Append-only
// (shares reject_append_only_mutation() + a role-level REVOKE); the analytics read
// role is denied SELECT. The DDL + guarantees live in migration 0022, not here.
const inet = customType<{ data: string }>({
  dataType() {
    return 'inet'
  },
})

export const accessLedger = pgTable(
  'access_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    event: text('event').notNull(),
    actorAccountId: uuid('actor_account_id').references(() => account.id),
    realActorAccountId: uuid('real_actor_account_id').references(() => account.id),
    subjectAccountId: uuid('subject_account_id').references(() => account.id),
    guardianAccountId: uuid('guardian_account_id').references(() => account.id),
    chapterId: uuid('chapter_id').references(() => chapter.id),
    inviteId: uuid('invite_id').references(() => invite.id),
    inviteKind: text('invite_kind'),
    targetEmail: citext('target_email'),
    consentRef: uuid('consent_ref'),
    consentMethod: text('consent_method'),
    clientIp: inet('client_ip'),
    detail: jsonb('detail').notNull().default({}),
  },
  (t) => [
    index('access_ledger_chapter_at_idx').on(t.chapterId, t.at),
    index('access_ledger_subject_at_idx').on(t.subjectAccountId, t.at),
    index('access_ledger_invite_idx').on(t.inviteId),
  ],
)

// --- Guardian-portal request and fee tables (Milestone 1 step 7) -----------
// Money is never a source of truth here (02-data-model.md): payment_ref holds a
// coarse status and a Stripe reference, no amount; scholarship holds a
// percentage. The compliance guarantee (a refused deletion carries a documented
// reason) lives in migration 0008 as a CHECK, not expressible here.

export const paymentRef = pgTable('payment_ref', {
  id: uuid('id').primaryKey().defaultRandom(),
  enrollmentRecordId: uuid('enrollment_record_id')
    .notNull()
    .references(() => enrollmentRecord.id),
  stripeCustomerRef: text('stripe_customer_ref'),
  status: paymentStatusEnum('status').notNull(),
  tierPaidFor: text('tier_paid_for'),
  createdAt: createdAt(),
})

export const scholarship = pgTable('scholarship', {
  id: uuid('id').primaryKey().defaultRandom(),
  enrollmentRecordId: uuid('enrollment_record_id')
    .notNull()
    .references(() => enrollmentRecord.id),
  awardedBy: uuid('awarded_by')
    .notNull()
    .references(() => account.id),
  percentage: integer('percentage').notNull(),
  note: text('note'),
  createdAt: createdAt(),
})

export const exportRequest = pgTable('export_request', {
  id: uuid('id').primaryKey().defaultRandom(),
  subjectAccountId: uuid('subject_account_id')
    .notNull()
    .references(() => account.id),
  requestedBy: uuid('requested_by')
    .notNull()
    .references(() => account.id),
  status: exportRequestStatusEnum('status').notNull(),
  fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
  createdAt: createdAt(),
})

export const deletionRequest = pgTable(
  'deletion_request',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectAccountId: uuid('subject_account_id')
      .notNull()
      .references(() => account.id),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => account.id),
    scopeRequested: deletionScopeEnum('scope_requested').notNull(),
    status: deletionRequestStatusEnum('status').notNull(),
    reviewedBy: uuid('reviewed_by').references(() => account.id),
    decisionReason: text('decision_reason'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    // A refused decision must carry a documented reason (02-data-model.md).
    check(
      'deletion_request_refusal_reason',
      sql`${t.status} <> 'refused' OR ${t.decisionReason} IS NOT NULL`,
    ),
  ],
)

// --- Community content (Milestone 2.1: the feed / The Lab) -----------------
// The typed projection of the feed content tables. The guarantees (the reaction
// uniqueness index, the timeline_entry append-only trigger + role-level REVOKE)
// live in migration 0013_feed_content.sql, not here. Authorship is by
// membership so a row carries the author's capacity and scope.

export const post = pgTable(
  'post',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => chapter.id),
    podId: uuid('pod_id').references(() => pod.id),
    authorMembershipId: uuid('author_membership_id')
      .notNull()
      .references(() => membership.id),
    type: postTypeEnum('type').notNull(),
    body: text('body').notNull(),
    status: contentStatusEnum('status').notNull().default('published'),
    systemGenerated: boolean('system_generated').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index('post_chapter_created_idx').on(t.chapterId, t.createdAt),
    index('post_pod_created_idx').on(t.podId, t.createdAt),
  ],
)

export const comment = pgTable(
  'comment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => post.id),
    authorMembershipId: uuid('author_membership_id')
      .notNull()
      .references(() => membership.id),
    body: text('body').notNull(),
    status: contentStatusEnum('status').notNull().default('published'),
    createdAt: createdAt(),
  },
  (t) => [index('comment_post_created_idx').on(t.postId, t.createdAt)],
)

export const reaction = pgTable(
  'reaction',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    targetType: reactionTargetTypeEnum('target_type').notNull(),
    // Polymorphic reference discriminated by target_type; carries no FK.
    targetId: uuid('target_id').notNull(),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => membership.id),
    kind: text('kind').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('reaction_unique').on(t.targetType, t.targetId, t.membershipId, t.kind),
  ],
)

export const timelineEntry = pgTable(
  'timeline_entry',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id),
    kind: text('kind').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    ref: uuid('ref'),
    createdAt: createdAt(),
  },
  (t) => [index('timeline_entry_account_occurred_idx').on(t.accountId, t.occurredAt)],
)

// --- Moderation (Milestone 2.4: the report queue) --------------------------
// The report a member files against feed content, and the queue a moderator
// works. Lifecycle state is derived from the timestamps (filed -> acknowledged
// -> resolved; escalated reachable from any pre-resolution state), not a status
// column. The SLA `due_at` is a GENERATED column (24h for safety, 72h for
// ordinary) so it cannot drift from the class; its authoritative DDL and the
// partial `(due_at) WHERE resolved_at IS NULL` index live in migration
// 0014_moderation.sql, exercised by the DB guarantee tests. target_id is a
// polymorphic reference discriminated by target_type and carries no FK.

export const moderationReport = pgTable(
  'moderation_report',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    targetType: moderationTargetTypeEnum('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    reporterAccountId: uuid('reporter_account_id')
      .notNull()
      .references(() => account.id),
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => chapter.id),
    class: moderationClassEnum('class').notNull(),
    reason: moderationReasonEnum('reason').notNull(),
    filedAt: timestamp('filed_at', { withTimezone: true }).notNull().defaultNow(),
    // GENERATED ALWAYS in the migration: filed_at + 24h (safety) / 72h (ordinary),
    // via immutable epoch arithmetic (see 0014_moderation.sql for why).
    dueAt: timestamp('due_at', { withTimezone: true }).generatedAlwaysAs(
      sql`to_timestamp(extract(epoch from (filed_at - '1970-01-01 00:00:00+00'::timestamptz)) + CASE WHEN class = 'safety' THEN 86400 ELSE 259200 END)`,
    ),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolverAccountId: uuid('resolver_account_id').references(() => account.id),
    resolverMembershipId: uuid('resolver_membership_id').references(() => membership.id),
    actionTaken: moderationActionEnum('action_taken'),
    escalatedAt: timestamp('escalated_at', { withTimezone: true }),
    escalatedTo: uuid('escalated_to').references(() => account.id),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    index('moderation_report_open_due_idx')
      .on(t.dueAt)
      .where(sql`${t.resolvedAt} is null`),
    index('moderation_report_chapter_idx').on(t.chapterId, t.filedAt),
  ],
)

// --- Project / media / profile / verification (Milestone 3.1) --------------
// The showcase spine: a project, its media (attached to a project or a feed
// post), the accounts a piece of media depicts, a member's profile narrative,
// and the single-use verification token that backs a shared public profile. The
// guarantees (verification_token one-live-per-subject partial unique index and
// token_hash uniqueness, media_depiction composite PK, the enum/default
// discipline, the Mechanism-A grants) live in migration 0015_project_media.sql,
// not here. The consent-driven couplings (C1 photo_media -> pending_review, C2
// public_listed -> external_publication) are deferred to their own phase.

export const project = pgTable(
  'project',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => chapter.id),
    // Ownership is by membership so a row carries the owner's capacity and scope.
    ownerMembershipId: uuid('owner_membership_id')
      .notNull()
      .references(() => membership.id),
    title: text('title').notNull(),
    summary: text('summary'),
    status: projectStatusEnum('status').notNull().default('draft'),
    verifiedBy: uuid('verified_by').references(() => account.id),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('project_chapter_status_idx').on(t.chapterId, t.status),
    index('project_owner_idx').on(t.ownerMembershipId),
  ],
)

export const projectMedia = pgTable(
  'project_media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Media hangs off either a project or a feed post; both fks are nullable.
    projectId: uuid('project_id').references(() => project.id),
    postId: uuid('post_id').references(() => post.id),
    storageRef: uuid('storage_ref').notNull(),
    reviewStatus: mediaReviewStatusEnum('review_status').notNull().default('pending_review'),
    createdAt: createdAt(),
  },
  (t) => [index('project_media_project_idx').on(t.projectId)],
)

export const mediaDepiction = pgTable(
  'media_depiction',
  {
    mediaId: uuid('media_id')
      .notNull()
      .references(() => projectMedia.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id),
    addedBy: uuid('added_by')
      .notNull()
      .references(() => account.id),
    source: mediaSourceEnum('source').notNull(),
    // Set by a mentor/staff confirmation to clear the image for gated uses.
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.mediaId, t.accountId] })],
)

export const profileNarrative = pgTable(
  'profile_narrative',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id),
    body: text('body').notNull(),
    status: narrativeStatusEnum('status').notNull().default('draft'),
    createdAt: createdAt(),
  },
  (t) => [index('profile_narrative_account_idx').on(t.accountId)],
)

// --- Newsletter (Milestone 3.5) --------------------------------------------
// A chapter (or platform-wide, chapter_id null) newsletter issue and its items.
// A `newsletter_item` with a non-null `author_student_account_id` is a
// student-authored item, which is how the publish gate (coupling E) requires
// that student's `external_publication` consent scoped to the ISSUE. Only
// `published` is readable without a session; `archived` is staff-read only —
// both are read-side policies enforced in the app layer, not the schema. The
// lifecycle guarantees (the status enum/default) and the Mechanism-A grants live
// in migration 0016_newsletter.sql, not here.

export const newsletterIssue = pgTable('newsletter_issue', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Null = platform-wide (02-data-model.md newsletter_issue).
  chapterId: uuid('chapter_id').references(() => chapter.id),
  title: text('title').notNull(),
  body: text('body').notNull(),
  status: newsletterIssueStatusEnum('status').notNull().default('draft'),
  // The recorded send time (set at `schedule`); the auto-publish job fires when
  // scheduled_for <= now.
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
  publishedBy: uuid('published_by').references(() => account.id),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: createdAt(),
})

export const newsletterItem = pgTable(
  'newsletter_item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => newsletterIssue.id),
    // Null = a staff-written item. Non-null = a student-authored item, whose
    // external_publication consent (scoped to the issue) the publish gate requires.
    authorStudentAccountId: uuid('author_student_account_id').references(() => account.id),
    // The project/post this item points at (no FK: a polymorphic reference).
    ref: uuid('ref'),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('newsletter_item_issue_idx').on(t.issueId)],
)

// --- Newsletter subscriber + webhook ledger (Milestone 3.6) ----------------
// The subscriber list lives OUTSIDE the account graph (no fk to account,
// 02-data-model.md). The one LIVE subscriber per email is the partial unique
// index (email) WHERE unsubscribed_at IS NULL — a pending/confirmed subscriber
// holds the slot, an unsubscribe frees it. The double-opt-in columns
// (confirm_token_hash, confirmed_at) support 05-api-surface.md's "double opt-in";
// delivery_status is a separate axis fed only by the Resend webhook. The
// guarantees (the partial unique index, the token-hash indexes, and the
// Mechanism-A grants) live in migration 0017_newsletter_subscriber.sql, not here.

export const newsletterSubscriber = pgTable(
  'newsletter_subscriber',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // citext, and NO fk to account — the list is outside the identity graph.
    email: citext('email').notNull(),
    unsubscribeTokenHash: text('unsubscribe_token_hash'),
    // Double opt-in: a pending subscriber carries a confirm token; confirmed_at
    // null = pending, set at confirm = active.
    confirmTokenHash: text('confirm_token_hash'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    subscribedAt: timestamp('subscribed_at', { withTimezone: true }).notNull().defaultNow(),
    unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
    source: text('source'),
    deliveryStatus: newsletterSubscriberDeliveryStatusEnum('delivery_status')
      .notNull()
      .default('active'),
    createdAt: createdAt(),
  },
  (t) => [
    // One LIVE subscriber per email; an unsubscribed row frees the slot.
    uniqueIndex('newsletter_subscriber_live_email_unique')
      .on(t.email)
      .where(sql`${t.unsubscribedAt} is null`),
    index('newsletter_subscriber_unsub_token_idx').on(t.unsubscribeTokenHash),
    index('newsletter_subscriber_confirm_token_idx').on(t.confirmTokenHash),
  ],
)

// The provider-webhook idempotency ledger. PK (provider, event_id): a replayed
// event is an ON CONFLICT DO NOTHING no-op in the same transaction as the status
// mutation, so a replay mutates nothing.
export const webhookEvent = pgTable(
  'webhook_event',
  {
    provider: text('provider').notNull(),
    eventId: text('event_id').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.eventId] })],
)

export const verificationToken = pgTable(
  'verification_token',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectAccountId: uuid('subject_account_id')
      .notNull()
      .references(() => account.id),
    tokenHash: text('token_hash').notNull(),
    issuedBy: uuid('issued_by')
      .notNull()
      .references(() => account.id),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('verification_token_hash_unique').on(t.tokenHash),
    // At most one LIVE token per subject; a revoked token no longer counts.
    uniqueIndex('verification_token_one_live_per_subject')
      .on(t.subjectAccountId)
      .where(sql`${t.revokedAt} is null`),
  ],
)

// --- Credential token (M1: password reset + account recovery) --------------
// The store that backs password reset (05-api-surface POST /auth/password/reset)
// and account recovery (06-onboarding-flows Flow D reissueSetup / account.recover
// — an adult former student's fresh setup token). A token is minted CSPRNG and
// only its hash lands here; it is consumed once (consumed_at). At most one LIVE
// (consumed_at IS NULL) token per (account, purpose) — a regenerate supersedes
// the prior — enforced by the partial unique index below. token_hash is globally
// unique so consumption resolves exactly one row. The guarantees and the
// Mechanism-A grants (app DML; analytics default-deny) live in migration
// 0019_credential_token.sql, not here.
export const credentialToken = pgTable(
  'credential_token',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id),
    tokenHash: text('token_hash').notNull(),
    purpose: credentialTokenPurposeEnum('purpose').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('credential_token_hash_unique').on(t.tokenHash),
    index('credential_token_account_idx').on(t.accountId),
    // At most one LIVE token per (account, purpose); a consumed token frees the slot.
    uniqueIndex('credential_token_one_live_per_purpose')
      .on(t.accountId, t.purpose)
      .where(sql`${t.consumedAt} is null`),
  ],
)

// --- TOTP two-factor (§10; migration 0023_totp_2fa.sql) --------------------
// The one-time recovery codes shown once at enrollment confirm. Each code_hash
// is argon2id (hashed like a password). Single-use: consumption stamps
// consumed_at (so the app role has UPDATE here, unlike the append-only ledgers).
export const totpBackupCode = pgTable(
  'totp_backup_code',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id),
    codeHash: text('code_hash').notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('totp_backup_code_account_idx').on(t.accountId).where(sql`${t.consumedAt} is null`),
  ],
)

// The second-factor attempt log — one row per attempt (success flag +
// timestamp). The service counts recent FAILURES in a rolling window at decision
// time and refuses once a cap is exceeded (rate limiting, no stateful lock).
export const totpAttempt = pgTable(
  'totp_attempt',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id),
    success: boolean('success').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('totp_attempt_account_at_idx').on(t.accountId, t.at)],
)
