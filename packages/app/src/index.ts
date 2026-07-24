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
  InviteCapability,
  InviteKind,
  IssueInviteInput,
  IssueInviteResult,
  InitiateDirectorInviteInput,
  InitiateDirectorInviteResult,
  ApproveDirectorInviteResult,
  AcceptExpectedBinding,
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
export { TwoFactorService } from './two-factor.js'
export type {
  TwoFactorServiceDeps,
  BeginEnrollmentResult,
  ConfirmEnrollmentResult,
  EnrollActivatedResult,
  VerifySecondFactorResult,
  IssuePendingLoginResult,
} from './two-factor.js'
export { bootstrapPlatformAdmin } from './bootstrap-admin.js'
export type { BootstrapAdminInput, BootstrapAdminResult } from './bootstrap-admin.js'
export { MaturationService, passwordResetRoute } from './maturation.js'
export type {
  MaturationServiceDeps,
  MaturationAuthorizeFn,
  AddEmailResult,
  ConfirmMaturationResult,
  ReissueSetupResult,
  AssistRecoveryResult,
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
  INVITE_ADULT_TTL_MS,
  INVITE_GUARDIAN_TTL_MS,
  INVITE_TTL_MS_BY_KIND,
  INVITE_RATE_LIMIT_WINDOW_MS,
  INVITE_RATE_LIMIT_MAX,
  type InviteKindTtl,
  PASSWORD_RESET_TTL_MS,
  TOTP_STEP_SECONDS,
  TOTP_DIGITS,
  TOTP_WINDOW_STEPS,
  TOTP_BACKUP_CODE_COUNT,
  TWO_FACTOR_PENDING_TTL_MS,
  TOTP_RATE_LIMIT_WINDOW_MS,
  TOTP_RATE_LIMIT_MAX,
  TOTP_ISSUER,
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
export {
  ConsentGrantService,
  CONSENT_GRANT_TYPES,
  hasActiveGrant,
  publicationGrantRevokeCascade,
  nominatePublicationHold,
  runPublicationHolds,
  lapseGuardianGrantsOnMaturation,
} from './consent-grant.js'
export type {
  ConsentGrantServiceDeps,
  ConsentGrantAuthorizeFn,
  ConsentGrantType,
  ConsentGrantMethod,
  CaptureGrantOptions,
  GrantResult,
  RevokeGrantResult,
  GrantStatus,
  GrantStatusView,
  ChildSummary,
  PublicItemView,
  NominateHoldArgs,
  NominateHoldResult,
  RunPublicationHoldsDeps,
  RunPublicationHoldsResult,
  PublicationReleasePublisher,
} from './consent-grant.js'
export {
  CONSENT_GRANT_LEDGER_ENFORCED,
  PUBLICATION_HOLD_WINDOW_MS,
  GRANT_RENEWAL_MS_BY_TYPE,
  STRONG_GRANT_METHODS,
  ENROLLMENT_REQUIRED_GRANT_TYPES,
  SELF_RECONFIRM_GRANT_TYPES,
} from './config.js'
export {
  GrantSubjectNotFoundError,
  GrantStrongMethodRequiredError,
  GrantRevocationEndsEnrollmentError,
  GrantNotActiveError,
  PublicationHoldNotFoundError,
  PublicationGrantRequiredError,
} from './errors.js'
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
export {
  runTimeBoxSweep,
  TIME_BOX_AUDIT_ACTION,
  type RunTimeBoxSweepDeps,
  type RunTimeBoxSweepResult,
} from './time-box-sweep.js'
export {
  MentorEligibilityService,
  loadMentorEligibility,
  MENTOR_ELIGIBILITY_COMPONENTS,
  MENTOR_ELIGIBILITY_AUDIT_ACTION,
} from './mentor-eligibility.js'
export type {
  MentorEligibilityServiceDeps,
  MentorEligibilityAuthorizeFn,
  MentorEligibilityComponent,
  RecordClearanceOptions,
  RecordClearanceResult,
  ComponentStatusView,
  MentorEligibilityView,
} from './mentor-eligibility.js'
export {
  runEligibilitySweep,
  ELIGIBILITY_LAPSED_REASON,
  type RunEligibilitySweepDeps,
  type RunEligibilitySweepResult,
} from './eligibility-sweep.js'
export { MENTOR_ELIGIBILITY_ENFORCED } from './config.js'
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
export { CalendarService } from './calendar.js'
export type {
  CalendarServiceDeps,
  CalendarAuthorizeFn,
  CalendarCapability,
  CalendarEvent,
  CalendarEventKind,
  CalendarAudience,
  CreateCalendarEventInput,
  EditCalendarEventInput,
  CancelCalendarEventResult,
  CalendarListQuery,
} from './calendar.js'
export { AttendanceService } from './attendance.js'
export type {
  AttendanceServiceDeps,
  AttendanceAuthorizeFn,
  AttendanceCapability,
  AttendanceException,
  AttendanceExceptionType,
  MakeupStatus,
  StaffRosterItem,
  AttendanceCounts,
  SubmitExceptionInput,
  AttendanceListQuery,
} from './attendance.js'
export { MessagingService } from './messaging.js'
export type {
  MessagingServiceDeps,
  MessagingAuthorizeFn,
  MessagingCapability,
  MessageSenderRole,
  Message,
  MessageThread,
  GuardianThread,
  StaffThreadListItem,
  StaffThreadDetail,
  SendMessageInput,
  StaffThreadsQuery,
} from './messaging.js'
export { OpsReadService, displayFromFullName } from './ops-read.js'
export type {
  OpsReadServiceDeps,
  OpsReadAuthorizeFn,
  OpsReadCapability,
  ApplicationListItem,
  ApplicationDetail,
  InviteListItem,
  MembershipListItem,
  GuardianshipListItem,
  MediaDepictionView,
  MediaReviewItem,
  SubjectRequestItem,
  DeletionRequestItem,
  ExportRequestItem,
  EnrollmentListItem,
  PodListItem,
  TermListItem,
  DashboardSummary,
  ApplicationListQuery,
  MembershipListQuery,
  ChapterScopedQuery,
} from './ops-read.js'
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
  InviteKindNotIssuableError,
  InviteRateLimitError,
  DirectorInviteRequestNotFoundError,
  DirectorInviteSameApproverError,
  DirectorInviteRequestNotPendingError,
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
  TotpNotActivatedError,
  TotpAlreadyActivatedError,
  TotpSecretMissingError,
  InvalidTotpCodeError,
  TotpRateLimitedError,
  CalendarEventNotFoundError,
  CalendarValidationError,
  AttendanceExceptionNotFoundError,
  AttendanceValidationError,
  AttendanceMakeupNotApplicableError,
  MessageThreadNotFoundError,
  MessagingValidationError,
  GrantSignedFormRequiredError,
  SafetyOfficerPeerConflictError,
  DmEnablePreconditionError,
  DmNotAuthorizedForPairError,
  DmThreadNotFoundError,
  DmThreadFrozenError,
  DmSuspensionReasonRequiredError,
  DmSuspensionNotFoundError,
  DmSuspensionSecondAdultInvalidError,
  DmSuspensionNotAcknowledgeableError,
  DmFlagNotFoundError,
} from './errors.js'
export {
  MENTOR_DM_ENABLED,
  DM_OPEN_HOUR_DEFAULT,
  DM_CLOSE_HOUR_DEFAULT,
  DM_RETENTION_MS,
  DM_FULL_REVIEW_MAX_WEEKLY_MESSAGES,
  DM_VISIBILITY_SUSPENSION_MS,
  DM_REPORTER_CHECKPOINT,
} from './config.js'
export {
  SafetyOfficerService,
  DmEnableService,
  DmThreadService,
  DM_VISIBILITY_HEADER_VERSION,
  DM_VISIBILITY_HEADER_TEXT,
} from './mentor-dm.js'
export type {
  SafetyOfficerServiceDeps,
  SafetyOfficerAuthorizeFn,
  SafetyOfficerAssignResult,
  DmEnableServiceDeps,
  DmEnableAuthorizeFn,
  InsuranceAttestationInput,
  DmThreadServiceDeps,
  DmDecryptedMessage,
  DmDraftCheckResult,
  DmThreadExport,
} from './mentor-dm.js'
export { DmClosedHoursError } from './errors.js'
export {
  DmOversightService,
  DmVisibilitySuspensionService,
  dmOversightReport,
  runDmFreezeOnDeparture,
} from './dm-oversight.js'
export type {
  DmOversightServiceDeps,
  DmOversightAuthorizeFn,
  DmQueueItem,
  DmThreadCoverage,
  DmReadingQueue,
  DmOversightReport,
  DmVisibilitySuspensionServiceDeps,
  DmSuspensionInitiateInput,
  DmSuspensionInitiateResult,
  RunDmFreezeOnDepartureArgs,
  RunDmFreezeOnDepartureResult,
} from './dm-oversight.js'
