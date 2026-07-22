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
} from './config.js'
export {
  writeApplicationEvent,
  type EventWriter,
  type ApplicationEventInput,
  type Db,
} from './events.js'
export { IllegalTransitionError, ApplicationNotFoundError } from './errors.js'
