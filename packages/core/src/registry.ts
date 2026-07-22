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
