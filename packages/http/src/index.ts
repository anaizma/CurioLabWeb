// -------------------------------------------------------------------------
// @curiolab/http — the framework-agnostic HTTP controller layer.
//
// One controller per Milestone 1 endpoint, shaped `(input) => Promise<{ status,
// body }>`. Each resolves the session token to an AuthContext (context.ts),
// runs inside `withRequest`, calls the service under `authorize`, and maps
// results/errors to `{ status, body }` (respond.ts). The Next route.ts adapters
// under app/api/** are thin wrappers over these.
// -------------------------------------------------------------------------

export type {
  ControllerResult,
  SessionDirective,
  AuthedInputBase,
  PublicInputBase,
} from './types.js'
export { SESSION_COOKIE } from './types.js'
export { getSql, setSqlForTesting } from './db.js'
export { ValidationError, mapError, FORBIDDEN_BODY, readJson } from './respond.js'
export { resolveAuthContext } from './context.js'
export { runAuthed, runPublic } from './run.js'

// The build-time route-manifest guard (07-test-plan "two invariant guards").
export {
  ROUTE_MANIFEST,
  SPEC_ENUMERATED_INERT,
  MUTATING_METHODS,
  isAuthorized,
  entryCapabilities,
  routeKey,
  routePathFromFile,
  parseExportedMethods,
  missingManifestEntries,
  staleManifestEntries,
  unknownCapabilities,
  assertManifestComplete,
} from './route-manifest.js'
export type {
  RouteManifest,
  RouteManifestEntry,
  AuthorizedEntry,
  InertEntry,
  DiscoveredRoute,
} from './route-manifest.js'

// Public funnel (Stage 2 token-gated chain; Stage 1 /api/apply is frontend-owned)
export {
  startStage2,
  saveParentSection,
  createStudentLink,
  saveStudentSection,
  getParentDraft,
  getStudentDraft,
  reviewStage2,
  submitStage2,
  sendBack,
} from './controllers/public.js'

// Auth
export {
  login,
  logout,
  getSession,
  submitTotp,
  beginTotpEnrollment,
  confirmTotpEnrollment,
  requestPasswordReset,
  resetPassword,
  completeRequiredPasswordChange,
  startImpersonation,
  endImpersonation,
} from './controllers/auth.js'
export type {
  SessionSummary,
  MembershipSummary,
  LoginInput,
  LoginResult,
  SubmitTotpInput,
  BeginTotpEnrollmentInput,
  ConfirmTotpEnrollmentInput,
  PasswordResetRoute,
  PasswordResetDelivery,
  RequestPasswordResetInput,
  ResetPasswordInput,
  CompleteRequiredPasswordChangeInput,
  StartImpersonationInput,
  StartImpersonationResult,
} from './controllers/auth.js'

// Invite onboarding entry (unauthenticated, actor-less, inert)
export { validateInviteToken, acceptInvite, acceptStudent } from './controllers/invites.js'
export type {
  ValidateInviteInput,
  AcceptInviteInput,
  AcceptStudentInput,
} from './controllers/invites.js'

// Student setup credential (§3): guardian mint + token-gated redemption
export { provisionStudentSetup, redeemStudentSetup } from './controllers/student-setup.js'
export type {
  ProvisionStudentSetupInput,
  RedeemStudentSetupInput,
} from './controllers/student-setup.js'

// Account lifecycle (coming of age + 16+ self_private)
export {
  addEmail,
  confirmMaturation,
  reissueSetup,
  assistRecovery,
  consumeAccountRecovery,
  selfPrivate,
} from './controllers/account-lifecycle.js'
export type {
  AddEmailInput,
  ConfirmMaturationInput,
  ReissueSetupInput,
  AssistRecoveryInput,
  ConsumeAccountRecoveryInput,
  SelfPrivateInput,
} from './controllers/account-lifecycle.js'

// Audit readers (chapter-scoped ops + global admin) + the §8 access-ledger read
export { readOpsAudit, readAdminAudit, readAccessLedger } from './controllers/audit.js'
export type {
  AuditEntryView,
  OpsAuditResult,
  AdminAuditResult,
  ReadAuditInput,
  AccessLedgerView,
  OpsAccessLedgerResult,
} from './controllers/audit.js'

// Trusted client-IP extraction for the §8 ledger
export { clientIpFromRequest } from './client-ip.js'

// Ops back office
export {
  transitionApplication,
  createEnrollment,
  issueInvite,
  initiateDirectorInvite,
  approveDirectorInvite,
  resendInvite,
  verifyGuardianship,
  revokeGuardianship,
  safeguardSuspend,
  activateMembership,
  reviewDeletion,
  fulfillDeletion,
  fulfillExport,
} from './controllers/ops.js'
export type {
  ApplicationTransitionBody,
  RevokeGuardianshipInput,
  SafeguardSuspendInput,
  SafeguardSuspendResult,
} from './controllers/ops.js'

// Ops back office — mentor eligibility as state (§6, REVIEW-GATED)
export {
  recordMentorEligibility,
  readMentorEligibility,
} from './controllers/mentor-eligibility.js'
export type {
  RecordMentorEligibilityInput,
  ReadMentorEligibilityInput,
} from './controllers/mentor-eligibility.js'

// Ops back office — director-portal READ surfaces (P1)
export {
  listApplications,
  getApplication,
  listInvites,
  listMemberships,
  listGuardianships,
  listMediaReviewQueue,
  listDeletionRequests,
  listExportRequests,
  listEnrollments,
  listPods,
  listTerms,
  opsDashboard,
} from './controllers/ops-read.js'
export type { ReadQueryInput, ReadDetailInput } from './controllers/ops-read.js'

// Ops back office — the editable application-form definition (GET/PUT)
export { getApplicationForm, putApplicationForm } from './controllers/application-form.js'
export type {
  ApplicationFormGetInput,
  ApplicationFormPutInput,
} from './controllers/application-form.js'

// Ops back office — director-editable consent forms (Consent Forms, Phase 2a)
export {
  listConsentForms,
  getConsentFormDetail,
  getEditableConsentForm,
  saveConsentForm,
  getConsentFormPdf,
} from './controllers/consent-forms-admin.js'
export type {
  ConsentFormDetailInput,
  ConsentFormKeyInput,
  ConsentFormPutInput,
  ConsentFormPdfResult,
} from './controllers/consent-forms-admin.js'

// Organization structure (Platform administration: chapters / terms / pods)
export {
  createChapter,
  updateChapter,
  createTerm,
  updateTerm,
  createPod,
  assignPod,
  unassignPod,
} from './controllers/org.js'
export type {
  CreateChapterInputHttp,
  UpdateChapterInputHttp,
  CreateTermInputHttp,
  UpdateTermInputHttp,
  CreatePodInputHttp,
  AssignPodInputHttp,
  UnassignPodInputHttp,
} from './controllers/org.js'

// Shared chapter calendar (guardian/director portal, Feature 1)
export {
  createCalendarEvent,
  editCalendarEvent,
  cancelCalendarEvent,
  listStaffCalendar,
  listGuardianCalendar,
} from './controllers/calendar.js'
export type {
  CreateCalendarInput,
  EditCalendarInput,
  CancelCalendarInput,
  StaffCalendarInput,
} from './controllers/calendar.js'

// Attendance & make-up check-ins (guardian/director portal, Feature 2)
export {
  submitAttendance,
  viewChildAttendance,
  listStaffAttendance,
  completeMakeup,
} from './controllers/attendance.js'
export type {
  SubmitAttendanceInput,
  ChildAttendanceInput,
  StaffAttendanceInput,
  CompleteMakeupInput,
} from './controllers/attendance.js'

// Guardian <-> chapter-staff messaging (guardian/director portal, Feature 3)
export {
  submitMessage,
  viewGuardianMessages,
  listStaffMessages,
  getStaffThread,
  replyStaffMessage,
} from './controllers/messaging.js'
export type {
  SubmitMessageInput,
  StaffMessagesInput,
  StaffThreadInput,
  ReplyMessageInput,
} from './controllers/messaging.js'

// Mentor-student direct messaging (Phase 1 setup + Phase 2 structural constraints,
// built DARK behind MENTOR_DM_ENABLED)
export {
  assignSafetyOfficer,
  recordDmInsurance,
  enableChapterDm,
  captureMentorDmConsent,
  checkDmDraft,
  exportDmThread,
  readDmQueue,
  readDmOversightReport,
  markDmThreadRead,
  reviewDmFlag,
  initiateDmSuspension,
  acknowledgeDmSuspension,
  sendDmMessage,
  listDmThreads,
  readDmThread,
  getDmOnboarding,
  ackDmOnboarding,
  reportDmThread,
  listDmReports,
  readChildDm,
  readChildDmDigest,
} from './controllers/mentor-dm.js'
export type {
  AssignSafetyOfficerInput,
  RecordDmInsuranceInput,
  EnableChapterDmInput,
  CaptureMentorDmConsentInput,
  CheckDmDraftInput,
  ExportDmThreadInput,
  ReadDmQueueInput,
  ReadDmOversightReportInput,
  MarkDmThreadReadInput,
  ReviewDmFlagInput,
  InitiateDmSuspensionInput,
  AcknowledgeDmSuspensionInput,
  SendDmMessageInput,
  ReadDmThreadInput,
  ReportDmThreadInput,
  ReadChildDmInput,
} from './controllers/mentor-dm.js'

// Guardian portal
export {
  viewChildRecord,
  viewChildFees,
  grantChildConsent,
  revokeChildConsent,
  requestChildExport,
  requestChildDeletion,
  viewDigest,
  listChildren,
  viewChildGrants,
  viewChildPublicItems,
  captureChildGrant,
  revokeChildGrant,
  objectPublicationHold,
} from './controllers/guardian.js'

// Guardian consent-form flow (resolved forms, drafts, completions)
export {
  listChildForms, getSavedFields, getFormDraft, saveFormDraft, submitFormCompletion, getChildFormPdf,
} from './controllers/consent-forms.js'
export type { ChildFormPdfResult } from './controllers/consent-forms.js'

// Public newsletter subscribe/confirm/unsubscribe (Milestone 3.6).
export {
  subscribeNewsletter,
  confirmNewsletter,
  unsubscribeNewsletter,
} from './controllers/newsletter.js'
export type {
  SubscribeNewsletterInput,
  SubscribeNewsletterResult,
  NewsletterTokenInput,
} from './controllers/newsletter.js'

// Provider webhooks (Milestone 3.6): actor-less, signature-verified, idempotent.
export { resendWebhook, stripeWebhook } from './controllers/webhooks.js'
export type { WebhookInput, WebhookResult } from './controllers/webhooks.js'
export { signWebhookBody, verifyWebhookSignature } from './webhook-signature.js'

// The Lab (internal feed)
export {
  viewFeed,
  createPost,
  editPost,
  removePost,
  hidePost,
  createComment,
  addReaction,
  removeReaction,
  fileReport,
  moderationQueue,
  transitionReport,
} from './controllers/lab.js'
export type {
  ViewFeedInput,
  CreatePostInputHttp,
  EditPostInput,
  PostIdInput,
  HidePostInput,
  CreateCommentInputHttp,
  ReactionInput,
  FileReportInputHttp,
  ModerationQueueInput,
  ModerationQueueRow,
  ModerationQueueResult,
  TransitionReportInput,
  ReportAction,
} from './controllers/lab.js'

// Student profile & narrative (M3.7)
export {
  viewProfile,
  editNarrative,
  reviewNarrative,
  regenerateVerificationToken,
} from './controllers/profile.js'
export type {
  ViewProfileInput,
  EditNarrativeInput,
  ReviewNarrativeInput,
  RegenerateVerificationTokenInput,
} from './controllers/profile.js'

// The public verification URL (M3.7)
export { viewVerification } from './controllers/verify.js'
export type { ViewVerificationInput } from './controllers/verify.js'

// Student notification-email settings (DARK, COUNSEL-GATED): the student-facing
// PRIMARY/SECONDARY self-service surface.
export {
  viewNotificationEmail,
  setNotificationEmail,
} from './controllers/student-notification.js'
export type {
  ViewNotificationEmailInput,
  SetNotificationEmailInput,
} from './controllers/student-notification.js'

// Account self-service ("My Information": GET/PATCH /api/account).
export { getAccount, updateAccount } from './controllers/account.js'
export type { GetAccountInput, UpdateAccountInputHttp } from './controllers/account.js'

// Project lifecycle (M3.7)
export {
  createProject,
  submitProject,
  verifyProject,
  publishProject,
  unpublishProject,
} from './controllers/projects.js'
export type {
  CreateProjectInputHttp,
  ProjectIdInput,
} from './controllers/projects.js'

// Media ops (M3.7)
export { attachMedia, confirmDepiction, clearMedia, removeMedia } from './controllers/media.js'
export type {
  AttachMediaInputHttp,
  ConfirmDepictionInputHttp,
  MediaIdInput,
} from './controllers/media.js'

// Newsletter ops (M3.7)
export {
  draftNewsletter,
  editNewsletter,
  submitNewsletter,
  scheduleNewsletter,
  publishNewsletter,
  unpublishNewsletter,
} from './controllers/newsletter-ops.js'
export type {
  DraftNewsletterInput,
  EditNewsletterInput,
  NewsletterIdInput,
  ScheduleNewsletterInput,
} from './controllers/newsletter-ops.js'

// Public reads (M3.7)
export {
  listPublicProjects,
  viewPublicProject,
  listPublicNewsletters,
  viewPublicNewsletter,
} from './controllers/public-reads.js'
export type {
  PublicProjectSummary,
  PublicProjectListResult,
  PublicProjectInput,
  PublicNewsletterSummary,
  PublicNewsletterListResult,
  PublicNewsletterItem,
  PublicNewsletterView,
  PublicNewsletterInput,
} from './controllers/public-reads.js'
