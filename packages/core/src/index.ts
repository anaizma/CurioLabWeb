// CurioLab platform core — public surface of the pure authorization engine.
export * from './types.js'
export { REGISTRY } from './registry.js'
export { platformGrant } from './platformGrant.js'
export { can } from './can.js'
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
