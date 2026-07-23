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
  chapterStatusEnum,
  chapterTierEnum,
  consentActionEnum,
  consentReasonEnum,
  consentSourceEnum,
  consentTypeEnum,
  contentStatusEnum,
  credentialOwnerEnum,
  deletionRequestStatusEnum,
  deletionScopeEnum,
  deliveryStatusEnum,
  dobProvenanceEnum,
  exportRequestStatusEnum,
  guardianshipStatusEnum,
  inviteKindEnum,
  inviteStatusEnum,
  maturationStateEnum,
  membershipStatusEnum,
  moderationActionEnum,
  moderationClassEnum,
  moderationReasonEnum,
  moderationTargetTypeEnum,
  paymentStatusEnum,
  postTypeEnum,
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
  issuedBy: uuid('issued_by')
    .notNull()
    .references(() => account.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  status: inviteStatusEnum('status').notNull(),
  deliveryStatus: deliveryStatusEnum('delivery_status').notNull(),
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
