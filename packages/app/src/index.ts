// -------------------------------------------------------------------------
// @curiolab/app — the application-service layer (Milestone 1, step 1).
//
// The framework-agnostic ApplicationService for the intake and ops review
// flow behind POST /public/apply and /ops/applications. It takes its db handle
// and an `authorize` dependency by injection; the HTTP layer is wired later.
// -------------------------------------------------------------------------

export { ApplicationService } from './service.js'
export type {
  ApplicationServiceDeps,
  AuthorizeFn,
  ApplicationKind,
  SubmitApplicationInput,
  SubmitApplicationResult,
  TransitionInput,
  TransitionOutcome,
  ReopenOutcome,
} from './service.js'
export { EnrollmentService } from './enrollment.js'
export type {
  EnrollmentServiceDeps,
  EnrollmentAuthorizeFn,
  CreateEnrollmentInput,
  CreateEnrollmentResult,
  SignedForm,
} from './enrollment.js'
export { InviteService } from './invite.js'
export type {
  InviteServiceDeps,
  InviteAuthorizeFn,
  InviteKind,
  IssueInviteInput,
  IssueInviteResult,
  ValidateInviteResult,
  AcceptCredentials,
  EmailCredentials,
  UsernameCredentials,
  AcceptInviteResult,
} from './invite.js'
export { GuardianshipService } from './guardianship.js'
export type {
  GuardianshipServiceDeps,
  GuardianshipAuthorizeFn,
  VerifyGuardianshipOptions,
  VerifyGuardianshipResult,
} from './guardianship.js'
export { MembershipActivationService } from './membership-activation.js'
export type {
  MembershipActivationServiceDeps,
  MembershipActivationAuthorizeFn,
  ActivateStudentOptions,
  ActivateStudentResult,
} from './membership-activation.js'
export { DobCorrectionService } from './dob-correction.js'
export type {
  DobCorrectionServiceDeps,
  DobCorrectionAuthorizeFn,
  DobCorrectionSubject,
  DobCorrectionResult,
} from './dob-correction.js'
export {
  InMemoryStorageAdapter,
  R2StorageAdapter,
  type StorageAdapter,
  type PutObjectInput,
  type R2Config,
} from './storage.js'
export {
  DEDUPE_WINDOW_MS,
  defaultConfig,
  type AppConfig,
  FORM_SOURCED_CONSENT_TYPES,
  SIGNED_FORM_KEY_PREFIX,
  SIGNED_FORM_CONTENT_TYPE,
  type FormSourcedConsentType,
  INVITE_TTL_MS,
  INVITE_INITIAL_DELIVERY_STATUS,
  GUARDIAN_RELATIONSHIP_DEFAULT,
  GUARDIAN_VERIFICATION_METHOD,
  normalizeGuardianName,
  guardianNamesMatch,
  type InviteInitialDeliveryStatus,
  type GuardianRelationship,
  type GuardianVerificationMethod,
} from './config.js'
export {
  writeApplicationEvent,
  type EventWriter,
  type ApplicationEventInput,
  type Db,
} from './events.js'
export {
  CONSENT_BLOCKS,
  SCOPED_CONSENT_TYPES,
  blockOf,
  isDigitallyGrantable,
  consentTypeRequiresScopeRef,
  type ConsentBlockId,
  type ConsentBlockDef,
} from './consent-blocks.js'
export {
  TIER_PROGRESSION_CAPABILITIES,
  publicProfileGatesAnyTierProgression,
} from './tier-progression.js'
export { ConsentService } from './consent.js'
export type {
  ConsentServiceDeps,
  ConsentAuthorizeFn,
  GrantConsentOptions,
  ConsentResult,
  RevokeCascade,
} from './consent.js'
export { GuardianPortalService } from './guardian-portal.js'
export type {
  GuardianPortalServiceDeps,
  GuardianPortalAuthorizeFn,
  DeletionScope,
  ChildRecord,
  ChildMembershipView,
  FeeStatus,
  ScholarshipView,
  ExportRequestResult,
  DeletionRequestResult,
  ChapterDigest,
} from './guardian-portal.js'
export {
  SEVEN_YEARS_MS,
  ONE_YEAR_MS,
  CONSENT_SEEKING_WINDOW_MS,
  CONTACT_TOMBSTONE,
  RETENTION_SCHEDULE,
  defaultRetentionConfig,
  type RetentionAnchor,
  type RetentionRule,
  type RetentionDataClass,
  type RetentionConfig,
} from './retention.js'
export {
  sweepUnconsentedApplications,
  type SweepUnconsentedApplicationsDeps,
  type SweepUnconsentedApplicationsResult,
} from './retention-sweep.js'
export {
  IllegalTransitionError,
  ApplicationNotFoundError,
  EnrollmentDobRequiredError,
  InviteNotFoundError,
  InvalidInviteError,
  InviteCredentialMismatchError,
  GuardianInviteEmailMismatchError,
  GuardianshipNotFoundError,
  DobCorrectionSubjectNotFoundError,
  IllegalGuardianshipTransitionError,
  MembershipNotFoundError,
  MembershipActivationConsentError,
  MembershipActivationEvidenceError,
  IllegalMembershipTransitionError,
  ConsentNotDigitallyGrantableError,
  ConsentScopeRefRequiredError,
  ConsentEnrollmentNotFoundError,
  GuardianChildNotFoundError,
} from './errors.js'
