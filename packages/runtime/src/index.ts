// -------------------------------------------------------------------------
// @curiolab/runtime — the Phase 0.4 enforcement layer.
//
// Session authentication, the audit writer, the `authorize` wrapper over the
// pure `can`, the AsyncLocalStorage authorization context with the
// repository-write backstop, and the build-time route manifest scaffold. This
// is the only layer that does IO for an authorization decision; @curiolab/core
// stays pure and @curiolab/db owns the schema and database floor.
// -------------------------------------------------------------------------

export { hashPassword, verifyPassword } from './password.js'
export { generateSessionToken, hashToken } from './tokens.js'
export {
  IMPERSONATION_TTL_MS,
  createSession,
  createImpersonationSession,
  validateSession,
  revokeSession,
  revokeAllSessionsForAccount,
  type CreateSessionArgs,
  type CreatedSession,
  type ValidatedSession,
} from './sessions.js'
export { writeAudit, type AuditEntryInput } from './audit.js'
export { withRlsContext, type RlsContext } from './rls.js'
export { authorize, type AuthorizeDeps } from './authorize.js'
export { Forbidden } from './errors.js'
export {
  withRequest,
  recordDecision,
  currentDecisions,
  assertAuthorized,
  type AuthDecisionRecord,
} from './context.js'
export {
  MUTATING_METHODS,
  ROUTE_MANIFEST,
  assertManifestComplete,
  missingManifestEntries,
  type DiscoveredRoute,
  type RouteManifest,
  type RouteManifestEntry,
} from './manifest.js'
