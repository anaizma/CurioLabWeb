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
export { DEDUPE_WINDOW_MS, defaultConfig, type AppConfig } from './config.js'
export {
  writeApplicationEvent,
  type EventWriter,
  type ApplicationEventInput,
  type Db,
} from './events.js'
export { IllegalTransitionError, ApplicationNotFoundError } from './errors.js'
