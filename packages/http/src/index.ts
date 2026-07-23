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
  reviewStage2,
  submitStage2,
  sendBack,
} from './controllers/public.js'

// Auth
export {
  login,
  logout,
  getSession,
  requestPasswordReset,
  resetPassword,
  startImpersonation,
  endImpersonation,
} from './controllers/auth.js'
export type {
  SessionSummary,
  MembershipSummary,
  PasswordResetRoute,
  PasswordResetDelivery,
  RequestPasswordResetInput,
  ResetPasswordInput,
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

// Account lifecycle (coming of age + 16+ self_private)
export {
  addEmail,
  confirmMaturation,
  reissueSetup,
  consumeAccountRecovery,
  selfPrivate,
} from './controllers/account-lifecycle.js'
export type {
  AddEmailInput,
  ConfirmMaturationInput,
  ReissueSetupInput,
  ConsumeAccountRecoveryInput,
  SelfPrivateInput,
} from './controllers/account-lifecycle.js'

// Audit readers (chapter-scoped ops + global admin)
export { readOpsAudit, readAdminAudit } from './controllers/audit.js'
export type {
  AuditEntryView,
  OpsAuditResult,
  AdminAuditResult,
  ReadAuditInput,
} from './controllers/audit.js'

// Ops back office
export {
  transitionApplication,
  createEnrollment,
  issueInvite,
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

// Guardian portal
export {
  viewChildRecord,
  viewChildFees,
  grantChildConsent,
  revokeChildConsent,
  requestChildExport,
  requestChildDeletion,
  viewDigest,
} from './controllers/guardian.js'

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
