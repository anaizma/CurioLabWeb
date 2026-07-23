// -------------------------------------------------------------------------
// CurioLab platform core — lifecycle transition guards.
//
// This module is the TRANSITION-LEGALITY layer. It answers one question:
// "Is moving a given entity from state A to state B a legal edge of that
// entity's lifecycle, and which capability does the spec say triggers it?"
//
// It is deliberately SEPARATE from `can` (the authorization engine). `can`
// answers "may THIS actor exercise a capability here?"; this module answers
// "is this a legal edge at all, and what capability guards it?". A real state
// change needs BOTH to hold. Keeping the two concerns apart means a legal edge
// with a forbidden actor and a permitted actor on an illegal edge both fail,
// each for its own honest reason.
//
// Everything here is pure, declarative data taken verbatim from
// `docs/platform/04-state-machines.md`. No IO, no imports outside this
// package, deterministic.
// -------------------------------------------------------------------------

import type { Capability } from './types.js'

// -------------------------------------------------------------------------
// Triggering capabilities.
//
// `04-state-machines.md` names many lifecycle-triggering capabilities that do
// not (yet) exist in the milestone-0 `Capability` union in types.ts — and that
// union cannot simply be extended, because REGISTRY is typed
// `Record<Capability, CapabilityDef>`, so any new member is a compile error
// until it also gets a registry row (out of scope for this task). We therefore
// REUSE `Capability` and widen it locally to `TransitionCapability`: every
// existing capability plus the lifecycle triggers the spec references. Where a
// trigger overlaps an existing `Capability` value it is reused, not redefined.
// -------------------------------------------------------------------------
export type TransitionCapability =
  | Capability
  // 'member.activate' is now a first-class Capability (added in M1 step 6), so it
  // arrives via `Capability` above and is not redeclared here.
  | 'member.invite'
  | 'account.suspend'
  | 'account.reinstate'
  | 'account.close'
  | 'membership.offboard'
  | 'membership.suspend'
  | 'membership.reinstate'
  // 'guardianship.verify' is now a first-class Capability (added in M1 step 4),
  // so it arrives via `Capability` above and is not redeclared here.
  | 'guardianship.revoke'
  | 'maturation.confirm'
  // 'newsletter.submit_review', 'newsletter.return', 'newsletter.schedule', and
  // 'newsletter.unpublish' are now first-class Capabilities (added in M3.5), so
  // they arrive via `Capability` above and are not redeclared here.
  // 'project.unpublish' is now a first-class Capability (added in M3.2), so it
  // arrives via `Capability` above and is not redeclared here.
  | 'consent.revoke_safeguarding'

/**
 * One legal edge. `from === null` is a creation edge (`(none) -> X` in the
 * spec tables): what capability brings the entity into being. `capability`
 * is omitted when the spec's trigger is not a capability at all — a single-use
 * token acceptance, a decision-time sweep, or a system re-check.
 */
export interface Transition {
  from: string | null
  to: string
  capability?: TransitionCapability
}

export interface MachineDef {
  states: readonly string[]
  /** States with no legal outgoing edge; any transition out of them is illegal. */
  terminal: readonly string[]
  transitions: readonly Transition[]
}

export type Machine =
  | 'account'
  | 'membership'
  | 'guardianship'
  | 'newsletter_issue'
  | 'feed_post'
  | 'comment'
  | 'project'
  | 'application'
  | 'invite'
  | 'moderation_report'
  | 'account_maturation'
  | 'deletion_request'

// -------------------------------------------------------------------------
// Account. States: invited, pending, active, suspended, closed.
// -------------------------------------------------------------------------
const ACCOUNT: MachineDef = {
  states: ['invited', 'pending', 'active', 'suspended', 'closed'],
  terminal: ['closed'],
  transitions: [
    { from: null, to: 'invited', capability: 'member.invite' },
    // accept invite (token) — invitee or guardian; no capability
    { from: 'invited', to: 'pending' },
    { from: 'pending', to: 'active', capability: 'member.activate' },
    { from: 'active', to: 'suspended', capability: 'account.suspend' },
    { from: 'suspended', to: 'active', capability: 'account.reinstate' },
    // any -> closed (expanded over every non-closed state)
    { from: 'invited', to: 'closed', capability: 'account.close' },
    { from: 'pending', to: 'closed', capability: 'account.close' },
    { from: 'active', to: 'closed', capability: 'account.close' },
    { from: 'suspended', to: 'closed', capability: 'account.close' },
  ],
}

// -------------------------------------------------------------------------
// Membership. States: pending, active, inactive, offboarded, suspended.
// Note: there is deliberately NO student -> alumni edge. Offboarding sets the
// student membership to `offboarded` KEEPING its role; the alumni membership
// is a separate new row (coupling B), not a role flip on this machine.
// -------------------------------------------------------------------------
const MEMBERSHIP: MachineDef = {
  states: ['pending', 'active', 'inactive', 'offboarded', 'suspended'],
  terminal: ['offboarded'],
  transitions: [
    // `member.invite` / enroll — the enroll alias is the same edge
    { from: null, to: 'pending', capability: 'member.invite' },
    { from: 'pending', to: 'active', capability: 'member.activate' },
    // window elapsed — system bookkeeping, no capability
    { from: 'active', to: 'inactive' },
    { from: 'active', to: 'offboarded', capability: 'membership.offboard' },
    { from: 'inactive', to: 'offboarded', capability: 'membership.offboard' },
    { from: 'active', to: 'suspended', capability: 'membership.suspend' },
    { from: 'suspended', to: 'active', capability: 'membership.reinstate' },
  ],
}

// -------------------------------------------------------------------------
// Guardianship. States: pending, verified, rejected, revoked, lapsed.
// -------------------------------------------------------------------------
const GUARDIANSHIP: MachineDef = {
  states: ['pending', 'verified', 'rejected', 'revoked', 'lapsed'],
  terminal: ['rejected', 'revoked', 'lapsed'],
  transitions: [
    // guardian invite issued — no capability named
    { from: null, to: 'pending' },
    { from: 'pending', to: 'verified', capability: 'guardianship.verify' },
    // mismatch outcome — same triggering capability, different result
    { from: 'pending', to: 'rejected', capability: 'guardianship.verify' },
    { from: 'verified', to: 'revoked', capability: 'guardianship.revoke' },
    // `maturation.confirm` OR the 90-day backstop (system) drive the same edge
    { from: 'verified', to: 'lapsed', capability: 'maturation.confirm' },
  ],
}

// -------------------------------------------------------------------------
// Newsletter issue. States: draft, in_review, scheduled, published, archived,
// blocked.
// -------------------------------------------------------------------------
const NEWSLETTER_ISSUE: MachineDef = {
  states: ['draft', 'in_review', 'scheduled', 'published', 'archived', 'blocked'],
  terminal: ['archived'],
  transitions: [
    { from: null, to: 'draft', capability: 'newsletter.draft' },
    { from: 'draft', to: 'in_review', capability: 'newsletter.submit_review' },
    { from: 'in_review', to: 'draft', capability: 'newsletter.return' },
    { from: 'in_review', to: 'scheduled', capability: 'newsletter.schedule' },
    { from: 'scheduled', to: 'published', capability: 'newsletter.publish' },
    // consent re-check fails — system, no capability
    { from: 'scheduled', to: 'blocked' },
    // retry after consent obtained
    { from: 'blocked', to: 'in_review', capability: 'newsletter.return' },
    { from: 'blocked', to: 'scheduled', capability: 'newsletter.schedule' },
    { from: 'published', to: 'archived', capability: 'newsletter.unpublish' },
  ],
}

// -------------------------------------------------------------------------
// Feed post and comment. States: published, hidden, removed. Same shape; only
// the creation capability differs (feed.post vs feed.comment).
// -------------------------------------------------------------------------
function feedLikeMachine(createCapability: TransitionCapability): MachineDef {
  return {
    states: ['published', 'hidden', 'removed'],
    terminal: ['removed'],
    transitions: [
      { from: null, to: 'published', capability: createCapability },
      // published -> hidden is guarded by feed.moderate OR feed.hide_safety
      { from: 'published', to: 'hidden', capability: 'feed.moderate' },
      { from: 'published', to: 'hidden', capability: 'feed.hide_safety' },
      { from: 'hidden', to: 'published', capability: 'feed.moderate' },
      { from: 'published', to: 'removed', capability: 'feed.moderate' },
      { from: 'hidden', to: 'removed', capability: 'feed.moderate' },
    ],
  }
}

const FEED_POST = feedLikeMachine('feed.post')
const COMMENT = feedLikeMachine('feed.comment')

// -------------------------------------------------------------------------
// Project. States: draft, submitted, verified, public_listed.
// -------------------------------------------------------------------------
const PROJECT: MachineDef = {
  states: ['draft', 'submitted', 'verified', 'public_listed'],
  terminal: [],
  transitions: [
    { from: null, to: 'draft', capability: 'project.create' },
    { from: 'draft', to: 'submitted', capability: 'project.submit' },
    { from: 'submitted', to: 'verified', capability: 'project.verify' },
    { from: 'verified', to: 'public_listed', capability: 'project.publish_public' },
    // de-list: `project.unpublish` (director) OR `consent.revoke` (system, C2)
    { from: 'public_listed', to: 'verified', capability: 'project.unpublish' },
  ],
}

// -------------------------------------------------------------------------
// Application. States: submitted, screening, interview_scheduled, accepted,
// enrolled, declined, withdrawn.
//
// The spec describes this machine in prose and names NO capabilities for the
// state changes (transitions are performed by relations_manager /
// chapter_director, with `submitted` public and `withdrawn` by applicant or
// staff). We therefore encode the natural funnel edges with no capability, and
// add the two spec-mandated branches: any active stage may be `declined` or
// `withdrawn`, and a `declined` application is reopenable back to `submitted`
// (the spec mints a successor `submitted` row via `reopened_from_id`; we model
// that here as a `declined -> submitted` edge so the legality query answers
// "yes, reopen is legal"). `enrolled` and `withdrawn` are terminal.
// -------------------------------------------------------------------------
const APPLICATION: MachineDef = {
  states: [
    'submitted',
    'screening',
    'interview_scheduled',
    'accepted',
    'enrolled',
    'declined',
    'withdrawn',
  ],
  terminal: ['enrolled', 'withdrawn'],
  transitions: [
    // public applicant submits — no capability
    { from: null, to: 'submitted' },
    { from: 'submitted', to: 'screening' },
    { from: 'screening', to: 'interview_scheduled' },
    { from: 'interview_scheduled', to: 'accepted' },
    { from: 'accepted', to: 'enrolled' },
    // decline from any active stage
    { from: 'submitted', to: 'declined' },
    { from: 'screening', to: 'declined' },
    { from: 'interview_scheduled', to: 'declined' },
    { from: 'accepted', to: 'declined' },
    // reopen a declined application
    { from: 'declined', to: 'submitted' },
    // withdraw from any active stage (applicant or staff)
    { from: 'submitted', to: 'withdrawn' },
    { from: 'screening', to: 'withdrawn' },
    { from: 'interview_scheduled', to: 'withdrawn' },
    { from: 'accepted', to: 'withdrawn' },
  ],
}

// -------------------------------------------------------------------------
// Invite. States: issued, accepted, expired, revoked. (delivery_status is
// orthogonal and NOT modeled here.)
// -------------------------------------------------------------------------
const INVITE: MachineDef = {
  states: ['issued', 'accepted', 'expired', 'revoked'],
  terminal: ['accepted', 'expired', 'revoked'],
  transitions: [
    // issuing the invite is the `member.invite` capability (see the account
    // machine's `(none) -> invited`, which creates the invite row)
    { from: null, to: 'issued', capability: 'member.invite' },
    // invitee via single-use token
    { from: 'issued', to: 'accepted' },
    // decision time past expires_at — system
    { from: 'issued', to: 'expired' },
    // on resend — old token discarded
    { from: 'issued', to: 'revoked' },
  ],
}

// -------------------------------------------------------------------------
// Moderation report. States: filed, acknowledged, resolved; escalated
// reachable from any pre-resolution state.
//
// Spec prose only. Filing is the `feed.report` capability; resolving is
// `moderation.resolve`. Acknowledgement and escalation name no capability
// (escalation is a timer job — system). We model filed -> acknowledged ->
// resolved, with escalation reachable from both pre-resolution states and an
// escalated report still resolvable.
// -------------------------------------------------------------------------
const MODERATION_REPORT: MachineDef = {
  states: ['filed', 'acknowledged', 'resolved', 'escalated'],
  terminal: ['resolved'],
  transitions: [
    { from: null, to: 'filed', capability: 'feed.report' },
    { from: 'filed', to: 'acknowledged' },
    { from: 'acknowledged', to: 'resolved', capability: 'moderation.resolve' },
    // escalated reachable from any pre-resolution state — system timer
    { from: 'filed', to: 'escalated' },
    { from: 'acknowledged', to: 'escalated' },
    { from: 'escalated', to: 'resolved', capability: 'moderation.resolve' },
  ],
}

// -------------------------------------------------------------------------
// Account maturation. States: minor, maturation_pending, self_managed.
// -------------------------------------------------------------------------
const ACCOUNT_MATURATION: MachineDef = {
  states: ['minor', 'maturation_pending', 'self_managed'],
  terminal: ['self_managed'],
  transitions: [
    // student adds and verifies an email — no capability
    { from: 'minor', to: 'maturation_pending' },
    { from: 'maturation_pending', to: 'self_managed', capability: 'maturation.confirm' },
  ],
}

// -------------------------------------------------------------------------
// Deletion request. States: requested, under_review, fulfilled_full,
// fulfilled_redaction, partially_fulfilled, refused.
//
// Spec prose only. `requested` is by guardian or self 18+, which is the
// `guardian.request_deletion` capability. The review outcomes name no
// capability. All four outcomes are terminal.
// -------------------------------------------------------------------------
const DELETION_REQUEST: MachineDef = {
  states: [
    'requested',
    'under_review',
    'fulfilled_full',
    'fulfilled_redaction',
    'partially_fulfilled',
    'refused',
  ],
  terminal: ['fulfilled_full', 'fulfilled_redaction', 'partially_fulfilled', 'refused'],
  transitions: [
    { from: null, to: 'requested', capability: 'guardian.request_deletion' },
    { from: 'requested', to: 'under_review' },
    { from: 'under_review', to: 'fulfilled_full' },
    { from: 'under_review', to: 'fulfilled_redaction' },
    { from: 'under_review', to: 'partially_fulfilled' },
    { from: 'under_review', to: 'refused' },
  ],
}

// -------------------------------------------------------------------------
// The machine registry. Consent is intentionally absent: it has no mutable
// state (see CONSENT_EVENTS below).
// -------------------------------------------------------------------------
export const MACHINES: Record<Machine, MachineDef> = {
  account: ACCOUNT,
  membership: MEMBERSHIP,
  guardianship: GUARDIANSHIP,
  newsletter_issue: NEWSLETTER_ISSUE,
  feed_post: FEED_POST,
  comment: COMMENT,
  project: PROJECT,
  application: APPLICATION,
  invite: INVITE,
  moderation_report: MODERATION_REPORT,
  account_maturation: ACCOUNT_MATURATION,
  deletion_request: DELETION_REQUEST,
}

export const ALL_MACHINES: readonly Machine[] = [
  'account',
  'membership',
  'guardianship',
  'newsletter_issue',
  'feed_post',
  'comment',
  'project',
  'application',
  'invite',
  'moderation_report',
  'account_maturation',
  'deletion_request',
]

// -------------------------------------------------------------------------
// Consent has NO mutable state. It is an append-only sequence of grant/revoke
// rows; the current state is a fold over that log (highest effective_at per
// type). It is therefore represented as its event list, NOT as a state
// machine, and is deliberately not a key of MACHINES / ALL_MACHINES.
// -------------------------------------------------------------------------
export interface ConsentEvent {
  action: 'grant' | 'revoke'
  /** What this event applies to; `null` for the whole-consent forms. */
  consentType:
    | 'enrollment'
    | 'data_collection'
    | 'platform_participation'
    | 'public_profile'
    | 'photo_media'
    | 'external_publication'
    | null
  /** Absent for the form-sourced grant, whose trigger is an enrollment upload. */
  capability?: TransitionCapability
}

export const CONSENT_EVENTS: readonly ConsentEvent[] = [
  // form-sourced grant — enrollment upload; no discrete capability
  { action: 'grant', consentType: 'enrollment' },
  { action: 'grant', consentType: 'data_collection' },
  // digital grant
  { action: 'grant', consentType: null, capability: 'consent.grant' },
  { action: 'revoke', consentType: 'photo_media', capability: 'consent.revoke' },
  { action: 'revoke', consentType: 'external_publication', capability: 'consent.revoke' },
  { action: 'revoke', consentType: 'platform_participation', capability: 'consent.revoke' },
  // safeguarding suspend — staff-initiated
  { action: 'revoke', consentType: 'public_profile', capability: 'consent.revoke_safeguarding' },
  { action: 'revoke', consentType: 'photo_media', capability: 'consent.revoke_safeguarding' },
]

// -------------------------------------------------------------------------
// The guard.
// -------------------------------------------------------------------------
export interface TransitionResult {
  allowed: boolean
  /** The capability the spec says triggers a legal edge, when it names one. */
  capability?: TransitionCapability
  /** Why an illegal transition was rejected. */
  reason?: 'unknown_state' | 'terminal_state' | 'illegal_transition'
}

/**
 * Pure transition-legality check. Answers whether `from -> to` is a legal edge
 * of `machine` and, when it is, the capability the spec names as its trigger.
 *
 * This does NOT evaluate actor permissions — that is `can`. A real state change
 * requires both a legal edge (here) and an authorized actor (`can`).
 *
 * `from === null` queries a creation edge (`(none) -> to`). Where an edge has
 * more than one triggering capability (e.g. a feed post hidden by `feed.moderate`
 * or `feed.hide_safety`), the first-listed capability is returned; the full set
 * is inspectable via `MACHINES[machine].transitions`.
 */
export function canTransition(
  machine: Machine,
  from: string | null,
  to: string,
): TransitionResult {
  const def = MACHINES[machine]

  const fromKnown = from === null || def.states.includes(from)
  if (!fromKnown || !def.states.includes(to)) {
    return { allowed: false, reason: 'unknown_state' }
  }

  if (from !== null && def.terminal.includes(from)) {
    return { allowed: false, reason: 'terminal_state' }
  }

  const edge = def.transitions.find((t) => t.from === from && t.to === to)
  if (!edge) {
    return { allowed: false, reason: 'illegal_transition' }
  }

  return edge.capability === undefined
    ? { allowed: true }
    : { allowed: true, capability: edge.capability }
}
