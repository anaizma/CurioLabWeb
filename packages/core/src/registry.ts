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

/**
 * Who may DRAFT / submit a newsletter issue (04-state-machines "(none) -> draft |
 * newsletter.draft | instructor, comms, director"). Drafting is WIDE: the two
 * instructor roles, comms, and the director. `junior_mentor` (a minor-eligible
 * assistant, "mentor" not "instructor") is deliberately excluded; publishing is
 * the separate, narrow, director-only gate.
 */
const NEWSLETTER_DRAFTERS: Role[] = [
  'senior_instructor',
  'lead_instructor',
  'comms_associate',
  'chapter_director',
]

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
  // 04-state-machines newsletter_issue lifecycle. Drafting/submitting is wide
  // (NEWSLETTER_DRAFTERS: instructor, comms, director); returning, scheduling,
  // publishing, and unpublishing are director-only (publish additionally runs the
  // per-item external_publication subject-consent gate, coupling E). A chapter_id
  // = null (platform-wide) issue matches no chapter membership, so a platform-wide
  // issue is reachable only through platformGrant (platform_admin for any of
  // these; platform_staff only for the zero-student publish exception).
  'newsletter.draft': {
    scope: 'chapter',
    roles: NEWSLETTER_DRAFTERS,
    writes: true,
  },
  // draft -> in_review, by the drafter. Same wide role floor as draft; the
  // "the drafter specifically" refinement is a service concern (the issue carries
  // no author column), mirroring project.create's chapter+role floor.
  'newsletter.submit_review': {
    scope: 'chapter',
    roles: NEWSLETTER_DRAFTERS,
    writes: true,
  },
  // in_review -> draft (and blocked -> in_review), director only.
  'newsletter.return': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: true,
  },
  // in_review -> scheduled (and blocked -> scheduled), records a send time;
  // chapter_director only.
  'newsletter.schedule': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: true,
  },
  'newsletter.publish': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: true,
    subjectConsent: externalPublicationForItems,
  },
  // published -> archived, "director, admin" (04-state-machines). Chapter-scoped
  // director; platform_admin via platformGrant (writes:true — platform_staff is
  // NOT, it only overrides reads and the zero-student publish). No subject-consent
  // snapshot: withdrawing reach never asserts consent (the consent-driven variant
  // rides ConsentService's revoke seam, like project C2).
  'newsletter.unpublish': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: true,
  },

  // ---- projects ------------------------------------------------------------
  // 04-state-machines project "(none) -> draft | student (own), instructor": a
  // student may open their own project, and any teaching membership in the
  // chapter may open one (e.g. a mentor seeding a pod project). The "own" bound
  // for a student is enforced by the ProjectService (it sets owner_membership_id
  // to the acting student's membership); `can` gates the chapter+role floor.
  'project.create': {
    scope: 'chapter',
    roles: ['student', ...TEACHING],
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
  // director de-list (04-state-machines project "public_listed -> verified |
  // project.unpublish | director"). Chapter-scoped, chapter_director. The C2
  // SYSTEM cascade (consent.revoke -> de-list) reaches the same edge without this
  // capability — it rides the consent.revoke authorization inside ConsentService.
  // No subject-consent snapshot: withdrawing reach never asserts consent.
  'project.unpublish': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: true,
  },

  // ---- media (the photo-review policy) -------------------------------------
  // 02-data-model.md project_media / media_depiction and the "who populates it"
  // media policy; 03-authorization.md the media.review capability; 05-api-surface
  // POST /ops/media/:id/{confirm-depiction,clear,remove}. A mentor or staff
  // authoritatively tags who is in an image and clears/removes it for
  // photo_media-gated use — a student may attach their own work but cannot
  // confirm depictions. Scope pod|chapter, roles TEACHING (a pod mentor in the
  // depicted student's pod, or a chapter director), mirroring feed.moderate;
  // platform_admin is covered by platformGrant (writes:true — platform_staff is
  // NOT, it only overrides reads). No consent gate on the ACTION itself: the
  // consent+confirmation rule that clears an image is encoded in the service's
  // isClearedForPublicUse, read from consent_current, not from `can`. Attaching
  // is NOT here — a student attaches to their OWN project, gated by project.submit
  // (own scope, student role), the ownership-of-the-project capability.
  'media.review': {
    scope: ['pod', 'chapter'],
    roles: TEACHING,
    writes: true,
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
  // lead → Stage 2 invite (milestone-1-application-funnel.md v2: staff decide
  // which leads are invited to apply; packages/app Stage2Service.startStage2). The
  // gate on issuing a parent Stage-2 token and creating the application_draft.
  // Chapter-scoped to the lead's chapter, chapter_director — mirroring the
  // application ops floor (04-state-machines names the actor "relations_manager or
  // chapter_director"; relations_manager is not a modeled Role, so the floor is
  // chapter_director, as with application.view/transition). Writes; the token
  // issue + draft create is the mutation. The three token-gated Stage-2 endpoints
  // (saveParentSection, saveStudentSection, reviewStage2, submitStage2, sendBack)
  // carry no AuthContext and do NOT pass through here — they are gated by the
  // opaque parent/student token, like the unauthenticated invite accept endpoints.
  'lead.invite': {
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
  // deletion review + tiered fulfillment, and export fulfillment (the ops
  // compliance side of Milestone 1; 04-state-machines deletion_request lifecycle;
  // compliance-coppa.md 1.6 the parent's deletion right + § 312.6(c) termination,
  // Part 3 tiered deletion; Part 2 Stage 4 the export review-right). All three are
  // chapter-scoped ops writes performed by the Chapter Director (packages/app
  // DeletionFulfillmentService / ExportFulfillmentService), resolved against the
  // subject's enrolling chapter; platform_admin is covered by platformGrant. No
  // subject-consent snapshot: a deletion HONORS a parent's direction (it is not
  // gated on the child's own consent), and the export is the parent's review right.
  'deletion.review': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: true,
  },
  'deletion.fulfill': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: true,
  },
  'export.fulfill': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: true,
  },

  // ---- coming of age (Milestone 4) -----------------------------------------
  // maturation confirm (Flow D step 3; 04-state-machines account_maturation
  // "maturation_pending -> self_managed | maturation.confirm | chapter_director",
  // and the coupled guardianship "verified -> lapsed"). The Chapter Director
  // confirms an adult student's coming-of-age: the account converts to
  // self_managed and the guardianship edge lapses (MaturationService). Chapter-
  // scoped to the student's enrolling chapter; platform_admin via platformGrant.
  // No subject-consent snapshot (a maturation is not a consent decision).
  'maturation.confirm': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: true,
  },
  // account recover / reissue-setup (Flow D step 4; 06-onboarding-flows "a
  // locked-out adult former student ... recovers via account.recover"). After a
  // documented identity check the Chapter Director mints a fresh setup token so
  // the adult former student adds an email and sets a new password. Rejected
  // against any account with an active membership (MaturationService.reissueSetup).
  // Chapter-scoped to the subject's enrolling chapter; platform_admin via
  // platformGrant. No subject-consent snapshot.
  'account.recover': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: true,
  },

  // ---- profile / narrative -------------------------------------------------
  // A member views their OWN composed profile (05-api-surface GET /profile/:id
  // "student.view_record or profile.view"). Own scope: the subject is the actor.
  // Staff read a student's record via student.view_record (which logs an
  // out-of-pod minor read); this own path is the self-view and never logs a read
  // of one's own record. A student or an alumnus (their showcase persists) may
  // view their own profile.
  'profile.view': {
    scope: 'own',
    roles: ['student', 'alumni'],
    writes: false,
  },
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
  // Staff moderation of a profile narrative: -> removed (02-data-model.md
  // "staff may remove or clear but never author"; 04-state-machines the narrative
  // machine's `-> removed`). Chapter-scoped; the same senior authority that
  // clears a narrative may remove one. Reportable-then-removed rides the
  // moderation_report path; this is the direct remove capability.
  'narrative.remove': {
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

  // ---- platform back office (M1 HTTP-completion) ---------------------------
  // impersonation start (05-api-surface `impersonation.start`, platform_admin
  // only). Scope 'platform', reachable ONLY through the platform override; roles
  // is empty because no chapter role ever satisfies it. writes:true is the whole
  // point: a `platform_admin` gets scope+role via `platformGrant`, but a
  // `platform_staff` (whose override covers reads and the zero-student publish
  // only) does NOT — so only the admin may impersonate. There is no consent gate.
  'impersonation.start': {
    scope: 'platform',
    roles: [],
    writes: true,
  },
  // audit-trail read (05-api-surface GET /ops/audit chapter-scoped; GET
  // /admin/audit global). A chapter_director reads their OWN chapter's trail via
  // the chapter scope; a `platform_admin` (and, since writes:false, a
  // `platform_staff`) reads any chapter — and the global trail — via the platform
  // override. Read-only, no consent gate.
  'audit.view': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: false,
  },

  // ---- guardianship revoke -------------------------------------------------
  // 04-state-machines guardianship `verified -> revoked` ("director, admin"):
  // guardian access ends immediately; consents granted BEFORE revocation stand; a
  // new guardian must be verified before further consent decisions. Chapter-scoped
  // write, chapter_director; platform_admin via the override. No subject-consent
  // snapshot (a revoke of the EDGE is not a consent decision), and the legality of
  // the edge itself is checked by `canTransition('guardianship','verified','revoked')`
  // in the service, not here.
  'guardianship.revoke': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: true,
  },

  // ---- safeguarding consent suspend ----------------------------------------
  // 04-state-machines consent "safeguarding suspend | consent.revoke_safeguarding |
  // chapter_director, admin": the ONE sanctioned STAFF write to consent. It inserts
  // `reason = safeguarding` revokes for `public_profile` and `photo_media` (firing
  // C1), pending a new guardian's decision. Chapter-scoped write, chapter_director,
  // admin via override — it deliberately does NOT ride the guardian/self scope the
  // ordinary consent.grant/revoke use, so a guardian cannot invoke it. No
  // subject-consent snapshot (staff safeguarding is not gated on the child's own
  // consent).
  'consent.revoke_safeguarding': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: true,
  },
}
