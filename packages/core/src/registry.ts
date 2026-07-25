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
  // ---- privileged invite kinds (admin/director backend P2 §1) --------------
  // Per-kind issuing authority for the two privileged kinds, layered ON TOP of
  // the base member.invite (which stays guardian/mentor/staff, director+comms).
  //
  // member.invite_admin: scope 'platform', roles [] — reachable ONLY through the
  // platform override, and writes:true, so a `platform_admin` satisfies it and a
  // `platform_staff` (read-only override) does NOT. This is the platform_admin's
  // UNILATERAL authority to mint a privileged invite: InviteService authorizes it
  // for `kind = 'admin'` (admin invites are platform_admin-only) AND for the
  // direct `kind = 'director'` path (a platform_admin acting alone may mint a
  // director invite; a lone chapter_director cannot — they deny out_of_scope here
  // and must use the two-person flow). Mirrors impersonation.start / chapter.manage.
  'member.invite_admin': {
    scope: 'platform',
    roles: [],
    writes: true,
  },
  // member.invite_director: scope 'chapter', roles [chapter_director] — the
  // authority to PARTICIPATE in the two-person director-invite flow (initiate a
  // pending request, and approve one). Two DISTINCT chapter_directors are required
  // to mint a director invite (the distinct-approver rule is enforced by the
  // service + the director_invite_request DB CHECK, not by `can`); a platform_admin
  // reaches it via the override. writes:true, so platform_staff does not.
  'member.invite_director': {
    scope: 'chapter',
    roles: ['chapter_director'],
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
  // minor account recovery — the logged mentor/director-assisted in-person path
  // (admin/director backend §9). Distinct from account.recover (the adult
  // former-student reissue): a mentor or instructor present with the minor mints a
  // fresh setup token AND writes an access_ledger row (who assisted, which minor,
  // when, IP). Chapter-scoped to the minor's enrolling chapter, teaching roles
  // (a pod mentor, an instructor, or the director); platform_admin via the
  // override. writes:true, so platform_staff (read-only override) does NOT reach it.
  'account.assist_recovery': {
    scope: 'chapter',
    roles: TEACHING,
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

  // ---- platform administration (org structure) -----------------------------
  // 05-api-surface "Platform administration": CRUD /admin/chapters, /admin/terms,
  // /admin/pods, standing up the organization. 02-data-model org structure
  // (chapter/term/pod/pod_assignment); 03-authorization the platform-vs-chapter
  // split. The three org services (ChapterService, TermService, PodService) each
  // gate through one of these.
  //
  // chapter.manage (create/update a chapter): scope 'platform', reachable ONLY
  // through the platform override — roles is empty because no chapter role ever
  // stands up or reconfigures a chapter, and a chapter cannot be its own scope on
  // create (no row yet). writes:true, so a `platform_admin` gets scope+role via
  // `platformGrant` while a `platform_staff` (read-only override) does NOT — this
  // is platform_admin only, mirroring impersonation.start.
  'chapter.manage': {
    scope: 'platform',
    roles: [],
    writes: true,
  },
  // term.manage (create/update a term within a chapter): chapter-scoped write,
  // chapter_director. A director manages terms only in THEIR chapter (a term in
  // another chapter denies out_of_scope); platform_admin manages any chapter via
  // the override. The resource is the term's chapter.
  'term.manage': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: true,
  },
  // pod.manage (create a pod; assign/unassign a senior instructor to a pod for a
  // term): chapter-scoped write, chapter_director, same director-scoping as
  // term.manage. The resource is the pod's chapter. pod_assignment is the entire
  // definition of instructor scope (02-data-model), written here.
  'pod.manage': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: true,
  },

  // ---- director-portal READ surfaces (admin/director work order P1) ---------
  // docs/platform/director-portal-read-endpoints.md: the chapter-scoped list/detail
  // GETs the director portal reads. Each is scope 'chapter', roles
  // [chapter_director], writes:false — a director reads their OWN chapter's rows
  // (another chapter denies out_of_scope), and both platform overrides reach them
  // (writes:false, so platform_staff's read-only override grants scope+role too).
  // These mirror the write capabilities the surfaces act through
  // (application.transition, member.invite, member.activate, guardianship.verify,
  // enrollment.create, pod.manage, deletion.*/export.*); the media review queue
  // reuses the existing media.review, so there is no media.read here.
  'application.read': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: false,
  },
  // the editable application-form definition WRITE (application-form-definition-
  // spec.md; PUT /api/ops/application-form). A chapter_director edits the funnel
  // questions for THEIR chapter (another chapter denies out_of_scope); a
  // platform_admin edits any via the override. writes:true, so a read-only
  // platform_staff does NOT reach it — distinct from the read-only application.read
  // the GET reuses. The server-side validation (student keys on the allowlist, no
  // identifying keys, fixed fields structurally immutable) is an app-service
  // concern layered on this floor, mirroring how term.manage gates the floor.
  'application.form.manage': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: true,
  },
  'invite.read': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: false,
  },
  'membership.read': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: false,
  },
  'guardianship.read': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: false,
  },
  'enrollment.read': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: false,
  },
  'pod.read': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: false,
  },
  'deletion.read': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: false,
  },
  'export.read': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: false,
  },
  // the append-only invitation/access ledger read (admin/director backend §8).
  // Chapter-scoped, chapter_director, writes:false — a director reads their OWN
  // chapter's origination/access provenance (another chapter denies out_of_scope);
  // both platform overrides reach it (writes:false, so platform_staff's read-only
  // override grants scope+role too). Mirrors audit.view, but a peer surface with
  // its own capability so the ledger and the audit trail scope independently.
  'ledger.read': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: false,
  },

  // ---- consent GRANT ledger — guardian-portal reads + object (§5) ----------
  // Additive to the P1 guardian read set. Each is guardian-scoped (roles [] —
  // guardianship itself is the authority), matched against ctx.guardianOf by the
  // guardian scope. The reads are writes:false and carry NO logsRead: they return
  // display names and already-public items, not the composed minor record (that
  // stays guardian.view_child_record with its minor_record.read obligation).
  // guardian.list_children authorizes against one of the guardian's verified
  // children (like guardian.view_digest); the per-child reads name the child.
  'guardian.list_children': {
    scope: 'guardian',
    roles: [],
    writes: false,
  },
  'guardian.view_grants': {
    scope: 'guardian',
    roles: [],
    writes: false,
  },
  'guardian.view_public_items': {
    scope: 'guardian',
    roles: [],
    writes: false,
  },
  // §5 Rule 3: the guardian withholds ONE nominated item during its notify-and-
  // object window, without touching the grant. Guardian-scoped write (the age-18
  // bar applies, like consent.revoke), naming the child; a lapsed/revoked edge
  // denies out_of_scope.
  'publication.object': {
    scope: 'guardian',
    roles: [],
    writes: true,
  },
  // ---- account-origination chain: verified guardian provisions the child (§3) ----
  // The verified guardian mints the one-time, guardian-routed `minor_setup`
  // credential for their child's pending shell account (the inert account created
  // at enrollment). Guardian-scoped write, roles [] — guardianship itself is the
  // authority, matched against ctx.guardianOf; an unverified/lapsed edge is absent
  // so it denies out_of_scope (the guardian-before-student COPPA floor is the scope
  // itself). writes:true, so the age-18 bar applies. The additional
  // participation-consent precondition (the guardian's platform_participation
  // consent on file) is enforced in the service (assertStudentGuardianGate),
  // layered on this scope floor — mirroring publication.object / attendance.submit.
  'guardian.provision_child': {
    scope: 'guardian',
    roles: [],
    writes: true,
  },

  // ---- mentor eligibility as state (admin/director backend §6) --------------
  // mentor.manage_eligibility: the ops/director authority to RECORD a mentor's
  // eligibility component clearances (background check, mandatory-reporter
  // training, CWRU affiliation, signed code of conduct). Chapter-scoped write,
  // chapter_director; platform_admin via the override (writes:true, so a read-only
  // platform_staff does NOT reach it), mirroring term.manage / member.activate.
  // The READ of a mentor's eligibility reuses the P1 `membership.read` roster read.
  // The ENFORCEMENT this feeds (withdrawing student-facing access from an
  // ineligible mentor) is a flag-gated predicate in `can`, not a capability.
  'mentor.manage_eligibility': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: true,
  },

  // ---- shared chapter calendar (guardian/director portal, Feature 1) --------
  // The director-authored, audience-scoped chapter calendar.
  //
  // calendar.manage: the chapter-scoped WRITE (create an event, edit a new
  // revision, cancel a tombstone). Chapter_director in THEIR chapter (another
  // chapter denies out_of_scope); platform_admin via the override (writes:true,
  // so a read-only platform_staff does NOT reach it), mirroring term.manage /
  // pod.manage.
  'calendar.manage': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: true,
  },
  // calendar.view: the chapter-scoped staff READ FLOOR. Roles TEACHING (a pod
  // mentor / instructor, or the chapter director) so a mentor can read their
  // chapter's calendar; the AUDIENCE refinement (a non-director teaching role sees
  // only mentor-audience events, a director sees every audience) is a Calendar
  // service concern layered on top of this role+scope floor — `can` gates the
  // floor, the service filters by audience, mirroring how project.create gates the
  // chapter+role floor and the service enforces the `own` bound. writes:false, so
  // BOTH platform overrides (admin + read-only staff) reach it, and a platform
  // reader sees every audience like a director.
  'calendar.view': {
    scope: 'chapter',
    roles: TEACHING,
    writes: false,
  },
  // guardian.view_calendar: the guardian-scoped READ of the child's-chapter
  // parent-audience events. roles [] — guardianship itself is the authority,
  // matched against ctx.guardianOf by the guardian scope; a lapsed/revoked edge is
  // absent so it denies. writes:false, no logsRead (it returns a chapter schedule,
  // not the composed minor record). Authorized against one of the guardian's
  // verified children, like guardian.view_digest / guardian.list_children.
  'guardian.view_calendar': {
    scope: 'guardian',
    roles: [],
    writes: false,
  },

  // ---- attendance & make-up check-ins (guardian/director portal, Feature 2) --
  // The guardian-submitted, staff-resolved attendance exception over a chapter
  // session (a kind='session' calendar_event from Feature 1).
  //
  // attendance.submit: the guardian-scoped WRITE — a guardian records an absent /
  // late exception for their OWN verified child. roles [] (guardianship itself is
  // the authority, matched against ctx.guardianOf by the guardian scope); a
  // lapsed/revoked edge is absent so it denies. writes:true, so the age-18 bar
  // applies (a guardian cannot submit for an 18+ former child), mirroring
  // consent.grant / publication.object.
  'attendance.submit': {
    scope: 'guardian',
    roles: [],
    writes: true,
  },
  // attendance.view_child: the guardian-scoped READ of the child's exceptions +
  // counts. roles [] (guardianship is the authority), writes:false, NO logsRead —
  // it returns attendance facts (not the composed minor record, which stays
  // guardian.view_child_record with its minor_record.read obligation). Guardian
  // READ persists through the child's majority (age-not-bounded, like
  // guardian.view_calendar), ending only at the edge's lapse.
  'attendance.view_child': {
    scope: 'guardian',
    roles: [],
    writes: false,
  },
  // attendance.view: the chapter-scoped staff READ floor. Roles TEACHING (a pod
  // mentor / instructor, or the chapter director) so the staff running a session
  // can see who is absent/late with pending make-ups; writes:false, so BOTH
  // platform overrides (admin + read-only staff) reach it. The display-name (minor
  // PII floor) and the sessionId/termId scoping are service concerns on top, like
  // calendar.view's audience refinement.
  'attendance.view': {
    scope: 'chapter',
    roles: TEACHING,
    writes: false,
  },
  // attendance.resolve: the chapter-scoped staff WRITE — a mentor / director marks
  // the 30-minute make-up check-in DONE (a new append-only revision, makeup_status
  // -> completed). A DISTINCT write capability from attendance.view: reads and
  // writes are not equivalent here (a read-only platform_staff may VIEW the roster
  // but must NOT complete a make-up), so completing is writes:true (a read-only
  // override does not reach it), mirroring calendar.manage vs calendar.view.
  'attendance.resolve': {
    scope: 'chapter',
    roles: TEACHING,
    writes: true,
  },

  // ---- guardian <-> chapter-staff messaging (guardian/director portal, Feature 3) ----
  // Threaded, append-only messaging between a guardian and their child's chapter's
  // staff (the chapter_director + that chapter's mentors).
  //
  // message.send: the guardian-scoped WRITE — a guardian creates a thread or
  // appends to their OWN existing thread. roles [] (guardianship itself is the
  // authority, matched against ctx.guardianOf by the guardian scope; a
  // lapsed/revoked edge is absent so it denies). writes:true, so the age-18 bar
  // applies (a guardian's write authority ends at the child's majority), mirroring
  // attendance.submit / consent.grant. The "own thread" and "chapter the guardian
  // has a child in" bounds are service concerns on top of the guardian scope.
  'message.send': {
    scope: 'guardian',
    roles: [],
    writes: true,
  },
  // message.view_own: the guardian-scoped READ of the guardian's OWN threads +
  // messages. roles [] (guardianship is the authority), writes:false, NO logsRead —
  // it returns the guardian's own conversations (not the composed minor record,
  // which stays guardian.view_child_record with its minor_record.read obligation).
  // Guardian READ persists through the child's majority (age-not-bounded, like
  // attendance.view_child / guardian.view_calendar), ending only at the edge's lapse.
  'message.view_own': {
    scope: 'guardian',
    roles: [],
    writes: false,
  },
  // message.view: the chapter-scoped staff READ floor. Roles TEACHING (a pod
  // mentor / instructor, or the chapter director) so the staff can read their
  // chapter's guardian threads; writes:false, so BOTH platform overrides (admin +
  // read-only staff) reach it. The same-chapter thread check and the guardian
  // display name are service concerns on top, like attendance.view.
  'message.view': {
    scope: 'chapter',
    roles: TEACHING,
    writes: false,
  },
  // message.reply: the chapter-scoped staff WRITE — a mentor / director appends a
  // reply to a guardian thread (a new append-only message; sender_role derived from
  // the replier's membership). A DISTINCT write capability from message.view: reads
  // and writes are not equivalent here (a read-only platform_staff may VIEW a thread
  // but must NOT post), so replying is writes:true (a read-only override does not
  // reach it), mirroring attendance.view vs attendance.resolve.
  'message.reply': {
    scope: 'chapter',
    roles: TEACHING,
    writes: true,
  },

  // ---- mentor-student direct messaging (design C.1, C.14; Phase 1, DARK) ------
  // Built behind MENTOR_DM_ENABLED (default false) and COUNSEL-GATED (Part B). No
  // capability here authorizes a real send with the flag off — canDirectMessage +
  // the DM services enforce the runtime gate on top of these floors.
  //
  // safety_officer.assign: the director/admin authority to name a chapter's
  // INDEPENDENT safety officer. Chapter-scoped write, chapter_director; platform_admin
  // via the override (writes:true, so a read-only platform_staff does NOT reach it),
  // mirroring term.manage / calendar.manage. The not-a-peer rule (the target may not
  // be a mentor/teaching or student in that chapter) is a SafetyOfficerService concern
  // + a DB guard, not `can`.
  'safety_officer.assign': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: true,
  },
  // dm.enable: the director/admin write that flips the chapter DM switch ON. Chapter-
  // scoped write, chapter_director; platform_admin via override. The enable-precondition
  // gate (a safety officer assigned + an insurance attestation recorded + ≥1 current-term
  // pod) is a DmEnableService concern, not `can`.
  'dm.enable': {
    scope: 'chapter',
    roles: ['chapter_director'],
    writes: true,
  },
  // dm.message: the PARTICIPANT pair WRITE (a mentor OR the student writes to their
  // authorized thread). Chapter-scoped; the role floor is the closed participant set
  // {student} ∪ TEACHING; `pairGated` marks it as the fully-gated supervised-pair shape
  // the no-direct-messaging guard admits (Part B). `can` floors "a participant role in
  // the chapter"; the SPECIFIC pair (this mentor ↔ this student) + the five DM legs are
  // enforced by canDirectMessage + the DM service on top. writes:true — a read-only
  // platform override cannot post.
  'dm.message': {
    scope: 'chapter',
    roles: ['student', ...TEACHING],
    writes: true,
    pairGated: true,
  },
  // dm.read_own: the PARTICIPANT pair READ (either participant reads their own thread).
  // Same chapter scope + participant floor + `pairGated` shape as dm.message; writes:false,
  // so both platform overrides reach it. The four-party read authorization (participants +
  // safety officer + guardians) is a DmThreadService concern layered on this floor.
  'dm.read_own': {
    scope: 'chapter',
    roles: ['student', ...TEACHING],
    writes: false,
    pairGated: true,
  },
  // dm.report: the PARTICIPANT "something feels off" report (design C.12; Phase 4).
  // A student (or a participant) files a low-stakes report that routes to the safety
  // officer and does NOT notify the mentor. Same chapter scope + closed participant
  // floor {student} ∪ TEACHING + `pairGated` shape as dm.message (a student IS a
  // party, so it needs the fully-gated-pair exemption in the no-DM guard); writes:true
  // — a read-only platform override cannot file a report. `can` floors "a participant
  // role in the chapter"; the SPECIFIC thread-party check (the reporter is a party to
  // the thread) and the safety-officer routing with NO mentor-visible signal are
  // DmParticipantService concerns on top. Its runtime is additionally dark-gated
  // (MENTOR_DM_ENABLED) — a report only exists over a real thread, which only exists
  // if canDirectMessage held at send time.
  'dm.report': {
    scope: 'chapter',
    roles: ['student', ...TEACHING],
    writes: true,
    pairGated: true,
  },
  // dm.oversee: the safety officer's chapter-wide DM read + flag review. Chapter-scoped,
  // roles [safety_officer] (a staff-only floor with NO student party — it rides the
  // existing guardian-staff exemption in the no-DM guard). writes:true (flag review /
  // read-receipts write), so a read-only platform override does not reach the write path.
  'dm.oversee': {
    scope: 'chapter',
    roles: ['safety_officer'],
    writes: true,
  },
  // ---- mentor-student DM Phase 3 (detection & oversight; design C.7/C.8, DARK) ----
  // dm.suspend_guardian_visibility: the safety officer's GUARDED suspension of a
  // guardian's standing read access (design C.8). Chapter-scoped write, roles
  // [safety_officer] — the ONLY role that may initiate (C.8: "and only the safety
  // officer"). The recorded reason, the second-adult acknowledgement, the 90-day
  // expiry, and the mandatory-reporter checkpoint are DmVisibilitySuspensionService
  // concerns on top of this floor. writes:true, so a read-only platform override
  // cannot suspend. Staff-only (no student party), so it rides the guardian-staff
  // exemption in the no-DM guard.
  'dm.suspend_guardian_visibility': {
    scope: 'chapter',
    roles: ['safety_officer'],
    writes: true,
  },
  // dm.acknowledge_visibility_suspension: the SECOND adult's acknowledgement that
  // brings a suspension into effect (design C.8). Chapter-scoped write, roles
  // [chapter_director, safety_officer] — a director or another safety officer, i.e.
  // NOT one of the student-mentoring teaching roles; the service additionally
  // enforces that the acknowledger is not a mentor in the chapter AND is distinct
  // from the initiating officer. writes:true. Staff-only (no student party), so it
  // rides the guardian-staff exemption in the no-DM guard.
  'dm.acknowledge_visibility_suspension': {
    scope: 'chapter',
    roles: ['chapter_director', 'safety_officer'],
    writes: true,
  },
}
