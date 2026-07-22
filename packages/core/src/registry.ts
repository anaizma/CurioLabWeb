import type {
  AuthContext,
  Capability,
  CapabilityDef,
  ConsentType,
  Resource,
  Role,
  SubjectConsentReq,
} from './types.js'

// -------------------------------------------------------------------------
// Role groupings used by the registry. A capability is a declaration, not
// code; `can` is the interpreter over these rows.
// -------------------------------------------------------------------------

/** Everyone who may participate in the feed (all but alumni / platform). */
const PARTICIPANTS: Role[] = [
  'student',
  'junior_mentor',
  'senior_instructor',
  'lead_instructor',
  'chapter_director',
  'comms_associate',
]

/** Teaching roles that can moderate, verify, and view records. */
const TEACHING: Role[] = [
  'junior_mentor',
  'senior_instructor',
  'lead_instructor',
  'chapter_director',
]

/** Senior teaching roles that clear narratives for public reach. */
const REVIEWERS: Role[] = ['lead_instructor', 'chapter_director']

// -------------------------------------------------------------------------
// Reusable condition helpers.
// -------------------------------------------------------------------------
const minorNeedsParticipation = (ctx: AuthContext): ConsentType[] =>
  ctx.account.age < 18 ? ['platform_participation'] : []

const isAdult = (ctx: AuthContext): boolean => ctx.account.age >= 18

/** external_publication scoped to this resource, for each authored item. */
const externalPublicationForItems = (resource: Resource): SubjectConsentReq[] =>
  (resource.studentAuthoredItems ?? []).map((item) => ({
    student: item.student,
    type: 'external_publication' as ConsentType,
    scopeRef: resource.id,
  }))

// -------------------------------------------------------------------------
// THE REGISTRY. This table is the capability matrix. There is nowhere else
// for a permission rule to hide.
// -------------------------------------------------------------------------
export const REGISTRY: Record<Capability, CapabilityDef> = {
  // ---- feed ----------------------------------------------------------------
  'feed.view': {
    scope: ['pod', 'chapter'],
    roles: PARTICIPANTS,
    writes: false,
    actorConsent: minorNeedsParticipation,
  },
  'feed.post': {
    scope: ['pod', 'chapter'],
    roles: PARTICIPANTS,
    writes: true,
    actorConsent: minorNeedsParticipation,
  },
  'feed.comment': {
    scope: ['pod', 'chapter'],
    roles: PARTICIPANTS,
    writes: true,
    actorConsent: minorNeedsParticipation,
  },
  'feed.react': {
    scope: ['pod', 'chapter'],
    roles: PARTICIPANTS,
    writes: true,
    actorConsent: minorNeedsParticipation,
  },
  'feed.report': {
    scope: ['pod', 'chapter'],
    roles: PARTICIPANTS,
    writes: true,
  },
  'feed.moderate': {
    scope: ['pod', 'chapter'],
    roles: TEACHING,
    writes: true,
  },
  'feed.hide_safety': {
    // Any teaching membership in the chapter, not pod-bound. No consent gate,
    // no age condition: a minor mentor may hide on sight.
    scope: 'chapter',
    roles: TEACHING,
    writes: true,
  },

  // ---- moderation ----------------------------------------------------------
  'moderation.resolve': {
    scope: 'chapter',
    roles: TEACHING,
    writes: true,
    actorCondition: isAdult, // a minor cannot resolve any report
  },

  // ---- newsletter ----------------------------------------------------------
  'newsletter.draft': {
    scope: 'chapter',
    roles: ['comms_associate', 'chapter_director'],
    writes: true,
  },
  'newsletter.publish': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: true,
    subjectConsent: externalPublicationForItems,
  },

  // ---- projects ------------------------------------------------------------
  'project.create': {
    scope: 'chapter',
    roles: ['student'],
    writes: true,
  },
  'project.submit': {
    scope: 'own',
    roles: ['student'],
    writes: true,
  },
  'project.verify': {
    // instructor in own pod or director; available to minors for now.
    scope: ['pod', 'chapter'],
    roles: TEACHING,
    writes: true,
  },
  'project.publish_public': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: true,
    subjectConsent: externalPublicationForItems,
  },

  // ---- application funnel (ops back office) --------------------------------
  // 05-api-surface: GET/PATCH /ops/applications -> application.view /
  // application.transition. 04-state-machines names the actor as
  // "relations_manager or chapter_director"; relations_manager is not a modeled
  // Role, so the ops floor here is chapter_director (documented in the app-layer
  // report). Chapter-scoped; the transition is the mutating capability.
  'application.view': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: false,
  },
  'application.transition': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: true,
  },
  // enrollment upload (Flow A step 2, coupling D): the Chapter Director records
  // the signed form, the enrollment record, and the two form-sourced consents in
  // one transaction. 04-state-machines names the actor "chapter_director".
  // Chapter-scoped; the write is the whole coupling.
  'enrollment.create': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: true,
  },
  // invite issue / resend (Flow A step 3, Flow B via guardian, Flow C step 2,
  // Flow E step 1; 05-api-surface POST /ops/invites, /:id/resend). The account
  // machine names the actor set "director, comms, admin" (04-state-machines
  // account row "(none) -> invited"): chapter_director and comms_associate are
  // the modeled chapter roles; platform_admin is covered by platformGrant (the
  // Seed-chapter and admin case in Flow E step 3). Chapter-scoped; the resource
  // is the chapter the invite is issued into. The three unauthenticated accept
  // endpoints carry no AuthContext and do NOT pass through here (05-api-surface
  // "single-code-path invariant").
  'member.invite': {
    scope: 'chapter',
    roles: ['chapter_director', 'comms_associate'],
    writes: true,
  },
  // membership activation (Flow B step 3; 04-state-machines account/membership
  // `pending -> active`, actor chapter_director; couplings A + F). The Chapter
  // Director activates a pending membership: the membership and its account move
  // `pending -> active` together (coupling A) and the initial tier_transition is
  // written (coupling F), all in one transaction (packages/app
  // MembershipActivationService). Chapter-scoped to the membership's chapter; the
  // write is the whole activation. The active-`enrollment`-consent precondition
  // is a database read in the service, not part of `can`.
  'member.activate': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: true,
  },
  // guardianship verify (Flow A step 6; 04-state-machines guardianship
  // "pending -> verified" / "pending -> rejected", both triggered by
  // `guardianship.verify`, actor chapter_director). The name-on-account /
  // name-on-form match is the authority floor: on match the edge verifies, on
  // mismatch it is rejected and the accepting account closed. Chapter-scoped to
  // the enrolling chapter; the write is the whole verify/reject decision.
  'guardianship.verify': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: true,
  },
  // DOB correction (the mistyped-scan case; 02-data-model.md, decision-log.md
  // "DOB on the enrollment record, reversed and refined"). The ONLY sanctioned
  // updater of an account's (and its seeding enrollment record's) write-once
  // date_of_birth. Chapter-scoped to the enrolling chapter, Chapter Director;
  // platform_admin is covered by platformGrant (writes:true, admin gets
  // scope+role). Every use is audited by the app-layer DobCorrectionService,
  // which is the single write path that trips the database's correction bypass.
  'dob.correct': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: true,
  },

  // ---- profile / narrative -------------------------------------------------
  'profile.edit_narrative': {
    scope: 'own',
    roles: ['student'],
    writes: true,
  },
  'narrative.review': {
    scope: 'chapter',
    roles: REVIEWERS,
    writes: true,
  },

  // ---- verification --------------------------------------------------------
  'verification.regenerate': {
    scope: ['own', 'guardian'],
    roles: ['student'],
    writes: true,
  },

  // ---- records -------------------------------------------------------------
  'student.view_record': {
    scope: ['pod', 'chapter'],
    roles: TEACHING,
    writes: false,
    logsRead: true,
  },

  // ---- guardian capabilities (the complete set) ----------------------------
  'guardian.view_child_record': {
    scope: 'guardian',
    roles: [],
    writes: false,
    logsRead: true,
  },
  'guardian.view_fee_status': {
    scope: 'guardian',
    roles: [],
    writes: false,
  },
  'consent.grant': {
    scope: ['guardian', 'own'],
    roles: ['student'],
    writes: true,
    ownCondition: isAdult, // an 18+ student self-grants
  },
  'consent.revoke': {
    scope: ['guardian', 'own'],
    roles: ['student'],
    writes: true,
    ownCondition: isAdult,
  },
  'guardian.request_export': {
    scope: 'guardian',
    roles: [],
    writes: true,
  },
  'guardian.request_deletion': {
    scope: 'guardian',
    roles: [],
    writes: true,
  },
  'guardian.view_digest': {
    scope: 'guardian',
    roles: [],
    writes: false,
  },
}
