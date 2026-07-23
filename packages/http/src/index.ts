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

// Public funnel
export {
  submitLead,
  startStage2,
  saveParentSection,
  saveStudentSection,
  reviewStage2,
  submitStage2,
  sendBack,
} from './controllers/public.js'

// Auth
export { login, logout, getSession } from './controllers/auth.js'
export type { SessionSummary, MembershipSummary } from './controllers/auth.js'

// Ops back office
export {
  transitionApplication,
  createEnrollment,
  issueInvite,
  resendInvite,
  verifyGuardianship,
  activateMembership,
  reviewDeletion,
  fulfillDeletion,
  fulfillExport,
} from './controllers/ops.js'
export type { ApplicationTransitionBody } from './controllers/ops.js'

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
