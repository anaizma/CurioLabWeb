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
  applicationKindEnum,
  applicationStatusEnum,
  chapterStatusEnum,
  chapterTierEnum,
  consentActionEnum,
  consentReasonEnum,
  consentSourceEnum,
  consentTypeEnum,
  credentialOwnerEnum,
  deliveryStatusEnum,
  dobProvenanceEnum,
  guardianshipStatusEnum,
  inviteKindEnum,
  inviteStatusEnum,
  maturationStateEnum,
  membershipStatusEnum,
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
