// CurioLab platform core — public surface of the pure authorization engine.
export * from './types.js'
export { REGISTRY } from './registry.js'
export {
  DIRECT_MESSAGING_SEGMENTS,
  isDirectMessagingCapability,
  directMessagingCapabilities,
} from './messaging-guard.js'
export { platformGrant } from './platformGrant.js'
export { PRIVILEGED_ROLES, requiresTwoFactor } from './privileged-roles.js'
export { can } from './can.js'
export {
  MENTOR_ELIGIBILITY_COMPONENTS,
  MENTOR_ELIGIBILITY_ROLES,
  STUDENT_FACING_CAPABILITIES,
  isComponentCurrent,
  evaluateMentorEligibility,
} from './mentor-eligibility.js'
export { canDirectMessage } from './direct-messaging.js'
export type {
  DirectMessageMentor,
  DirectMessageStudent,
  DmGrantSnapshot,
} from './direct-messaging.js'
export { detectDmContentFlags, DM_CONTENT_MATCHERS } from './dm-content-flags.js'
export type { DmContentFlag, DmContentMatcher } from './dm-content-flags.js'
export type {
  MentorEligibilityComponent,
  MentorEligibilityComponentSnapshot,
  MentorEligibilityResult,
} from './mentor-eligibility.js'
export {
  MACHINES,
  ALL_MACHINES,
  CONSENT_EVENTS,
  canTransition,
} from './transitions.js'
export type {
  Machine,
  MachineDef,
  Transition,
  TransitionCapability,
  TransitionResult,
  ConsentEvent,
} from './transitions.js'
