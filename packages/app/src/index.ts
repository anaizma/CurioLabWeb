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
  RevokeGuardianshipOptions,
  RevokeGuardianshipResult,
} from './guardianship.js'
export { MembershipActivationService } from './membership-activation.js'
export type {
  MembershipActivationServiceDeps,
  MembershipActivationAuthorizeFn,
  ActivateStudentOptions,
  ActivateStudentResult,
} from './membership-activation.js'
export {
  MilestoneService,
  MILESTONE_JOINED_KIND,
  MILESTONE_TIER_KIND,
  MILESTONE_JOINED_BODY,
  tierMilestoneBody,
} from './milestone.js'
export type { EmitMilestoneParams, EmitMilestoneResult } from './milestone.js'
export { CredentialTokenService } from './credential-token.js'
export type {
  CredentialTokenServiceDeps,
  PasswordResetRoute as CredentialPasswordResetRoute,
  IssuePasswordResetResult,
  ConsumePasswordResetResult,
} from './credential-token.js'
export { MaturationService, passwordResetRoute } from './maturation.js'
export type {
  MaturationServiceDeps,
  MaturationAuthorizeFn,
  AddEmailResult,
  ConfirmMaturationResult,
  ReissueSetupResult,
  ConsumeAccountRecoveryResult,
  PrivatizeCredentialResult,
  MaturationLapseNotice,
  SweepMaturationDeps,
  SweepMaturationResult,
} from './maturation.js'
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
export { LeadService } from './lead.js'
export type {
  LeadServiceDeps,
  CreateLeadInput,
  CreateLeadResult,
} from './lead.js'
export {
  ResendMailer,
  NoopMailer,
  FakeMailer,
  defaultMailer,
} from './mail.js'
export type { Mailer, MailMessage } from './mail.js'
export { Stage2Service } from './stage2.js'
export type {
  Stage2ServiceDeps,
  Answers,
  StartStage2Result,
  CreateStudentLinkResult,
  ReviewStage2Result,
  SubmitStage2Result,
  GetParentDraftResult,
  GetStudentDraftResult,
} from './stage2.js'
export {
  LEAD_DEDUPE_WINDOW_MS,
  LEAD_EXPIRY_WINDOW_MS,
  STAGE2_STUDENT_ALLOWED_FIELDS,
  STAGE2_IDENTIFYING_KEY_PATTERN,
  APPLY_FROM_EMAIL,
  APP_URL,
  defaultConfig,
  type AppConfig,
  FORM_SOURCED_CONSENT_TYPES,
  SIGNED_FORM_KEY_PREFIX,
  SIGNED_FORM_CONTENT_TYPE,
  type FormSourcedConsentType,
  INVITE_TTL_MS,
  PASSWORD_RESET_TTL_MS,
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
  sweepExpiredLeads,
  type SweepExpiredLeadsDeps,
  type SweepExpiredLeadsResult,
} from './retention-sweep.js'
export { DeletionFulfillmentService } from './deletion-fulfillment.js'
export type {
  DeletionFulfillmentServiceDeps,
  DeletionFulfillmentAuthorizeFn,
  DeletionOutcome,
  DeletionRequestStatus,
  ReviewDeletionResult,
  FulfillDeletionResult,
} from './deletion-fulfillment.js'
export { ExportFulfillmentService } from './export-fulfillment.js'
export type {
  ExportFulfillmentServiceDeps,
  ExportFulfillmentAuthorizeFn,
  ExportBundle,
  ExportMembershipView,
  ExportTierTransitionView,
  FulfillExportResult,
} from './export-fulfillment.js'
export {
  PostService,
  CommentService,
  ReactionService,
  FeedService,
  FEED_DEFAULT_LIMIT,
  FEED_MAX_LIMIT,
} from './feed.js'
export type {
  FeedServiceDeps,
  FeedAuthorizeFn,
  FeedAuditWriter,
  AuthoredPostType,
  CreatePostInput,
  CreatePostResult,
  EditPostResult,
  CreateCommentInput,
  CreateCommentResult,
  ReactionTarget,
  AddReactionResult,
  RemoveReactionResult,
  ContentStatusResult,
  HideSafetyResult,
  FeedFilters,
  FeedPostView,
  FeedViewResult,
} from './feed.js'
export { ChapterService } from './chapter.js'
export type {
  ChapterServiceDeps,
  ChapterAuthorizeFn,
  ChapterTier,
  ChapterStatus,
  CreateChapterInput,
  UpdateChapterInput,
  ChapterResult,
} from './chapter.js'
export { TermService } from './term.js'
export type {
  TermServiceDeps,
  TermAuthorizeFn,
  CreateTermInput,
  UpdateTermInput,
  TermResult,
} from './term.js'
export { PodService } from './pod.js'
export type {
  PodServiceDeps,
  PodAuthorizeFn,
  CreatePodInput,
  PodResult,
  PodAssignmentResult,
  UnassignResult,
} from './pod.js'
export { ProjectService, projectExternalPublicationRevokeCascade } from './project.js'
export type {
  ProjectServiceDeps,
  ProjectAuthorizeFn,
  CreateProjectInput,
  ProjectResult,
} from './project.js'
export {
  MediaService,
  mediaPhotoMediaRevokeCascade,
  composeRevokeCascades,
} from './media.js'
export type {
  MediaServiceDeps,
  MediaAuthorizeFn,
  AttachMediaInput,
  AttachDepictionInput,
  AttachMediaResult,
  MediaReviewResult,
  ConfirmDepictionResult,
} from './media.js'
export { ProfileService } from './profile.js'
export type {
  ProfileServiceDeps,
  ProfileAuthorizeFn,
  ProfileView,
  ProfileProjectView,
  ProfileTimelineView,
  ProfileMembershipView,
  EditNarrativeResult,
  NarrativeStatusResult,
} from './profile.js'
export { VerificationService } from './verification.js'
export type {
  VerificationServiceDeps,
  VerificationAuthorizeFn,
  RegenerateVerificationResult,
  VerificationRecord,
  VerificationProject,
  VerificationView,
} from './verification.js'
export {
  NewsletterService,
  runScheduledNewsletters,
  REDACTED_NEWSLETTER_ITEM_BODY,
} from './newsletter.js'
export type {
  NewsletterServiceDeps,
  NewsletterAuthorizeFn,
  NewsletterCapability,
  CreateNewsletterInput,
  NewsletterItemInput,
  NewsletterResult,
  UnblockTarget,
  UnpublishOptions,
  EnqueueSend,
  NewsletterNotifier,
  NewsletterNotification,
  RunScheduledNewslettersDeps,
  RunScheduledNewslettersResult,
} from './newsletter.js'
export { SubscriberService } from './subscriber.js'
export type {
  SubscriberServiceDeps,
  SubscribeInput,
  SubscribeResult,
  ConfirmResult,
  UnsubscribeResult,
} from './subscriber.js'
export { ModerationService, sweepOverdueReports } from './moderation.js'
export type {
  ModerationServiceDeps,
  ModerationAuthorizeFn,
  ModerationNotifier,
  ModerationNotification,
  ModerationClass,
  ModerationReason,
  ModerationAction,
  ModerationState,
  ModerationTarget,
  FileReportInput,
  FileReportResult,
  AcknowledgeResult,
  ResolveResult,
  EscalateResult,
  SweepOverdueReportsDeps,
  SweepOverdueReportsResult,
} from './moderation.js'
export {
  IllegalTransitionError,
  ApplicationNotFoundError,
  EnrollmentDobRequiredError,
  LeadNotFoundError,
  Stage2AlreadyStartedError,
  InvalidStage2TokenError,
  Stage2LeadExpiredError,
  Stage2NotInPhaseError,
  StudentSectionIdentifyingFieldError,
  StudentSectionFieldNotAllowedError,
  Stage2ParentFactsIncompleteError,
  Stage2LeadChapterRequiredError,
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
  DeletionRequestNotFoundError,
  ExportRequestNotFoundError,
  DeletionSubjectChapterNotFoundError,
  IllegalDeletionTransitionError,
  DeletionReasonRequiredError,
  PostNotFoundError,
  CommentNotFoundError,
  PostMilestoneForbiddenError,
  IllegalFeedContentTransitionError,
  FeedAuthorMembershipNotFoundError,
  ModerationReportNotFoundError,
  IllegalModerationTransitionError,
  ProjectNotFoundError,
  IllegalProjectTransitionError,
  NewsletterIssueNotFoundError,
  IllegalNewsletterTransitionError,
  NewsletterPublishConsentChangedError,
  MediaNotFoundError,
  MediaNotClearableError,
  ProfileSubjectNotFoundError,
  NarrativeNotFoundError,
  IllegalNarrativeTransitionError,
  VerificationSubjectNotFoundError,
  InvalidSubscriberTokenError,
  MaturationAccountNotFoundError,
  MaturationChapterNotFoundError,
  MaturationNotSelfError,
  MaturationAgeError,
  IllegalMaturationTransitionError,
  ReissueActiveMembershipError,
  CredentialWitnessRequiredError,
  CredentialWitnessInvalidError,
  CredentialWitnessIsGuardianError,
  InvalidCredentialTokenError,
  ChapterNotFoundError,
  TermNotFoundError,
  PodNotFoundError,
} from './errors.js'
