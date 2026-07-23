// -------------------------------------------------------------------------
// Postgres enums for the CurioLab data model.
//
// Where @curiolab/core already declares an enum (Role, ConsentType, account /
// membership / session statuses, tier, ...), the value arrays below are bound
// to the core union with `satisfies`, so a drift between this schema and the
// pure authorization core is a COMPILE error, not a silent runtime mismatch.
// core is the single source of truth; these are the database projection of it.
// -------------------------------------------------------------------------

import { pgEnum } from 'drizzle-orm/pg-core'
import {
  ALL_ROLES,
  type AccountStatus,
  type ConsentType,
  type CredentialOwner,
  type MaturationState,
  type MembershipStatus,
  type SessionMode,
  type Tier,
} from '@curiolab/core'

/** Helper: assert a tuple is a non-empty enum tuple for pgEnum. */
type Enum = readonly [string, ...string[]]

// --- reused directly from core ---
export const roleEnum = pgEnum('role', ALL_ROLES as unknown as Enum)

const ACCOUNT_STATUS = [
  'invited',
  'pending',
  'active',
  'suspended',
  'closed',
] as const satisfies readonly AccountStatus[]
export const accountStatusEnum = pgEnum('account_status', ACCOUNT_STATUS)

const MATURATION_STATE = [
  'minor',
  'maturation_pending',
  'self_managed',
] as const satisfies readonly MaturationState[]
export const maturationStateEnum = pgEnum('maturation_state', MATURATION_STATE)

const CREDENTIAL_OWNER = [
  'guardian_provisioned',
  'self_private',
] as const satisfies readonly CredentialOwner[]
export const credentialOwnerEnum = pgEnum('credential_owner', CREDENTIAL_OWNER)

const MEMBERSHIP_STATUS = [
  'pending',
  'active',
  'inactive',
  'offboarded',
  'suspended',
] as const satisfies readonly MembershipStatus[]
export const membershipStatusEnum = pgEnum('membership_status', MEMBERSHIP_STATUS)

const SESSION_MODE = ['full', 'read_only'] as const satisfies readonly SessionMode[]
export const sessionModeEnum = pgEnum('session_mode', SESSION_MODE)

const TIER = ['explorer', 'builder', 'innovator'] as const satisfies readonly Tier[]
export const tierEnum = pgEnum('tier', TIER)

const CONSENT_TYPE = [
  'enrollment',
  'data_collection',
  'platform_participation',
  'public_profile',
  'photo_media',
  'external_publication',
] as const satisfies readonly ConsentType[]
export const consentTypeEnum = pgEnum('consent_type', CONSENT_TYPE)

// --- db-only enums (not modeled in the pure core) ---
export const chapterTierEnum = pgEnum('chapter_tier', ['seed', 'active', 'distinguished'])
export const chapterStatusEnum = pgEnum('chapter_status', [
  'prospective',
  'active',
  'paused',
  'closed',
])
export const dobProvenanceEnum = pgEnum('dob_provenance', [
  'enrollment_record',
  'self_reported',
  'staff_entered',
])
export const inviteKindEnum = pgEnum('invite_kind', ['guardian', 'student', 'mentor', 'staff'])
export const inviteStatusEnum = pgEnum('invite_status', [
  'issued',
  'accepted',
  'expired',
  'revoked',
])
export const deliveryStatusEnum = pgEnum('delivery_status', [
  'sent',
  'delivered',
  'bounced',
  'complained',
])
export const applicationKindEnum = pgEnum('application_kind', ['student', 'university_role'])
export const applicationStatusEnum = pgEnum('application_status', [
  'submitted',
  'screening',
  'interview_scheduled',
  'accepted',
  'enrolled',
  'declined',
  'withdrawn',
])
// --- Application-funnel v2 (Milestone 1 part A) ---
export const applicationLeadStatusEnum = pgEnum('application_lead_status', [
  'new',
  'stage2_started',
  'converted',
  'deleted',
])
// Who filled the Stage 1 form — drives the confirmation copy (design §7.1).
export const applicationLeadFillerRoleEnum = pgEnum('application_lead_filler_role', [
  'parent',
  'student',
])
export const applicationDraftPhaseEnum = pgEnum('application_draft_phase', [
  '2a',
  '2b',
  '2c',
  'submitted',
])
export const applicationDraftStatusEnum = pgEnum('application_draft_status', [
  'in_progress',
  '2b_saved',
  'sent_back',
  'submitted',
])
export const relationshipEnum = pgEnum('relationship', ['parent', 'guardian', 'other'])
export const guardianshipStatusEnum = pgEnum('guardianship_status', [
  'pending',
  'verified',
  'rejected',
  'revoked',
  'lapsed',
])
export const verificationMethodEnum = pgEnum('verification_method', [
  'signed_form_match',
  'in_person_witnessed',
  'sms_form_match',
])
export const consentActionEnum = pgEnum('consent_action', ['grant', 'revoke'])
export const consentSourceEnum = pgEnum('consent_source', ['signed_form', 'digital'])
export const consentReasonEnum = pgEnum('consent_reason', ['standard', 'safeguarding'])

// --- guardian-portal request and fee tables (Milestone 1 step 7) ---
export const paymentStatusEnum = pgEnum('payment_status', [
  'none',
  'active',
  'past_due',
  'waived',
])
export const deletionScopeEnum = pgEnum('deletion_scope', ['full', 'redaction'])
export const deletionRequestStatusEnum = pgEnum('deletion_request_status', [
  'requested',
  'under_review',
  'fulfilled_full',
  'fulfilled_redaction',
  'partially_fulfilled',
  'refused',
])
export const exportRequestStatusEnum = pgEnum('export_request_status', [
  'requested',
  'fulfilled',
])

// --- Community content (Milestone 2.1: the feed / The Lab) ---
export const postTypeEnum = pgEnum('post_type', [
  'wip',
  'finished_project',
  'question',
  'session_recap',
  'milestone',
])
// One lifecycle for both post and comment ("Same machine as post").
export const contentStatusEnum = pgEnum('content_status', ['published', 'hidden', 'removed'])
export const reactionTargetTypeEnum = pgEnum('reaction_target_type', ['post', 'comment'])

// --- Moderation (Milestone 2.4) ---
export const moderationTargetTypeEnum = pgEnum('moderation_target_type', [
  'post',
  'comment',
  'project_media',
  'profile_narrative',
])
// The report class drives the SLA (the generated due_at): safety = 24h, ordinary = 72h.
export const moderationClassEnum = pgEnum('moderation_class', ['safety', 'ordinary'])
export const moderationReasonEnum = pgEnum('moderation_reason', [
  'harmful',
  'sexual',
  'threatening',
  'self_harm_disclosure',
  'off_topic',
  'unkind',
  'spam',
  'quality',
])
export const moderationActionEnum = pgEnum('moderation_action', [
  'none',
  'hidden',
  'removed',
  'dismissed',
  'escalated',
])

// --- Project / media / profile / verification (Milestone 3.1) ---
export const projectStatusEnum = pgEnum('project_status', [
  'draft',
  'submitted',
  'verified',
  'public_listed',
])
export const mediaReviewStatusEnum = pgEnum('media_review_status', [
  'ok',
  'pending_review',
  'removed',
])
// Who asserted a depiction; only mentor/staff authoritatively clears an image.
export const mediaSourceEnum = pgEnum('media_source', ['student', 'mentor', 'staff'])
// The narrative lifecycle (distinct from content_status: it carries pending_review).
export const narrativeStatusEnum = pgEnum('narrative_status', [
  'draft',
  'pending_review',
  'published',
  'removed',
])

// --- Newsletter (Milestone 3.5) ---
// The newsletter_issue lifecycle (04-state-machines newsletter_issue):
// draft -> in_review -> scheduled -> published -> archived, plus `blocked` (a
// scheduled issue whose consent re-check failed).
export const newsletterIssueStatusEnum = pgEnum('newsletter_issue_status', [
  'draft',
  'in_review',
  'scheduled',
  'published',
  'archived',
  'blocked',
])

// --- Credential token (M1: password reset + account recovery) ---
// The purpose of a credential_token row: a password reset (05-api-surface.md
// /auth/password/reset) or an account recovery setup token (06-onboarding-flows
// Flow D reissueSetup / account.recover). Only its hash is stored; it is consumed
// once. Not modeled in the pure core (a persistence concern).
export const credentialTokenPurposeEnum = pgEnum('credential_token_purpose', [
  'password_reset',
  'account_recovery',
])

// --- Newsletter subscriber (Milestone 3.6) ---
// The subscriber delivery axis (02-data-model.md newsletter_subscriber): fed by
// the Resend webhook, distinct from the invite `delivery_status` enum.
export const newsletterSubscriberDeliveryStatusEnum = pgEnum(
  'newsletter_subscriber_delivery_status',
  ['active', 'bounced', 'complained'],
)
