// -------------------------------------------------------------------------
// Mentor-student direct messaging (Phase 1) — the backend HTTP adapters over the
// app services (design C.1, C.3, Part D). Built DARK behind MENTOR_DM_ENABLED;
// these endpoints set up the enable-preconditions and capture consent, but no DM
// SEND/READ endpoint exists yet (Phase 4). Each resolves a session to an
// AuthContext and calls its service under `authorize`; a deny is an opaque 403.
//
//   assignSafetyOfficer      POST /api/ops/safety-officers               (safety_officer.assign, director/admin)
//   recordDmInsurance        POST /api/ops/dm/attestations               (dm.enable, director/admin)
//   enableChapterDm          POST /api/ops/dm/enable                     (dm.enable, director/admin)
//   captureMentorDmConsent   POST /api/guardian/children/:id/dm-consent  (consent.grant, guardian; signed_form)
//
// Phase 2 (structural constraints):
//   checkDmDraft             POST /api/dm/check-draft                    (pre-send contact-info check; pure detector, writes nothing — inert)
//   exportDmThread           GET  /api/dm/threads/:threadId/export       (student-or-guardian scoped; GET read-exempt; dark-gated)
// -------------------------------------------------------------------------

import {
  ConsentGrantService,
  DmEnableService,
  DmGuardianDmService,
  DmOversightService,
  DmParticipantService,
  DmThreadService,
  DmVisibilitySuspensionService,
  SafetyOfficerService,
  type DmChildDigest,
  type DmDraftCheckResult,
  type DmOnboardingView,
  type DmOversightReport,
  type DmReadingQueue,
  type DmReportView,
  type DmSuspensionInitiateResult,
  type DmThreadDetail,
  type DmThreadExport,
  type DmThreadListItem,
  type GrantResult,
  type SafetyOfficerAssignResult,
} from '@curiolab/app'
import { authorize } from '@curiolab/runtime'
import { runAuthed } from '../run.js'
import { optStr, reqStr } from '../respond.js'
import type { AuthedInputBase, ControllerResult } from '../types.js'

// ---- safety officer assignment (design C.1) -------------------------------

export interface AssignSafetyOfficerInput extends AuthedInputBase {
  body: { chapterId?: unknown; accountId?: unknown }
}

/** POST /api/ops/safety-officers — name a chapter's safety officer (safety_officer.assign). */
export function assignSafetyOfficer(
  input: AssignSafetyOfficerInput,
): Promise<ControllerResult<SafetyOfficerAssignResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const chapterId = reqStr(input.body?.chapterId, 'chapterId')
    const accountId = reqStr(input.body?.accountId, 'accountId')
    const result = await new SafetyOfficerService({ sql, authorize }).assign(chapterId, accountId, ctx)
    return { status: 201, body: result }
  })
}

// ---- insurance attestation + enable (design Part D) -----------------------

export interface RecordDmInsuranceInput extends AuthedInputBase {
  body: { chapterId?: unknown; carrier?: unknown; policyRef?: unknown }
}

/** POST /api/ops/dm/attestations — record a chapter's abuse-and-molestation insurance (dm.enable). */
export function recordDmInsurance(
  input: RecordDmInsuranceInput,
): Promise<ControllerResult<{ attestationId: string; chapterId: string }>> {
  return runAuthed(input, async (ctx, sql) => {
    const chapterId = reqStr(input.body?.chapterId, 'chapterId')
    const result = await new DmEnableService({ sql, authorize }).recordInsuranceAttestation(
      chapterId,
      { carrier: optStr(input.body?.carrier), policyRef: optStr(input.body?.policyRef) },
      ctx,
    )
    return { status: 201, body: result }
  })
}

export interface EnableChapterDmInput extends AuthedInputBase {
  body: { chapterId?: unknown }
}

/** POST /api/ops/dm/enable — flip the chapter DM switch on, gated on the preconditions (dm.enable). */
export function enableChapterDm(
  input: EnableChapterDmInput,
): Promise<ControllerResult<{ chapterId: string; alreadyEnabled: boolean }>> {
  return runAuthed(input, async (ctx, sql) => {
    const chapterId = reqStr(input.body?.chapterId, 'chapterId')
    const result = await new DmEnableService({ sql, authorize }).enable(chapterId, ctx)
    return { status: 201, body: result }
  })
}

// ---- mentor_dm consent capture (design C.3; reuses ConsentGrantService) ----

export interface CaptureMentorDmConsentInput extends AuthedInputBase {
  params: { id?: unknown }
  body: { evidenceArtifactRef?: unknown; scope?: unknown }
}

/**
 * POST /api/guardian/children/:id/dm-consent — a guardian captures the
 * mentor_dm signed-form consent for their child (consent.grant). Method is fixed
 * to `signed_form`; the service + DB trigger refuse a click / missing artifact.
 * Reuses ConsentGrantService.captureGrant (no forked write authority).
 */
export function captureMentorDmConsent(
  input: CaptureMentorDmConsentInput,
): Promise<ControllerResult<GrantResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const childId = reqStr(input.params?.id, 'id')
    const result = await new ConsentGrantService({ sql, authorize }).captureGrant(childId, 'mentor_dm', ctx, {
      method: 'signed_form',
      evidenceArtifactRef: reqStr(input.body?.evidenceArtifactRef, 'evidenceArtifactRef'),
      scope: optStr(input.body?.scope),
    })
    return { status: 201, body: result }
  })
}

// ---- Phase 2: pre-send contact-info check (design C.4) --------------------

export interface CheckDmDraftInput extends AuthedInputBase {
  body: { body?: unknown }
}

/**
 * POST /api/dm/check-draft — the PRE-SEND contact-info check (design C.4). Runs the
 * PURE core detector over a draft body and returns the flags WITHOUT sending, so the
 * frontend can render its interstitial. Session-gated (a null session -> opaque 403),
 * but writes NOTHING and calls no `authorize` — it is INERT in the route manifest.
 * POST (not GET) only because the draft body travels in the request body.
 */
export function checkDmDraft(input: CheckDmDraftInput): Promise<ControllerResult<DmDraftCheckResult>> {
  return runAuthed(input, async (_ctx, sql) => {
    const draft = reqStr(input.body?.body, 'body')
    const result = new DmThreadService({ sql }).checkDraft(draft)
    return { status: 200, body: result }
  })
}

// ---- Phase 2: thread export (design C.4) ----------------------------------

export interface ExportDmThreadInput extends AuthedInputBase {
  params: { threadId?: unknown }
}

/**
 * GET /api/dm/threads/:threadId/export — export the FULL decrypted thread (design
 * C.4), scoped so ONLY the student (their own thread) or a verified guardian of that
 * student can export; anyone else gets an opaque 403. A read of already-authorized
 * data (GET, read-exempt from the manifest), but dark-gated: with MENTOR_DM_ENABLED
 * off the service refuses (there are no real threads anyway).
 */
export function exportDmThread(input: ExportDmThreadInput): Promise<ControllerResult<DmThreadExport>> {
  return runAuthed(input, async (ctx, sql) => {
    const threadId = reqStr(input.params?.threadId, 'threadId')
    const now = input.now ?? new Date()
    const result = await new DmThreadService({ sql }).exportThread(threadId, ctx.account.id, now)
    return { status: 200, body: result }
  })
}

// ---- Phase 3: detection & oversight (design C.6, C.7, C.8) -----------------
// All DARK behind MENTOR_DM_ENABLED — the services refuse with the flag off.
//
//   readDmQueue            GET  /api/ops/dm/queue                          (dm.oversee; GET read-exempt, logs monitoring ledger)
//   readDmOversightReport  GET  /api/ops/dm/oversight-report              (dm.oversee; GET read-exempt)
//   markDmThreadRead       POST /api/ops/dm/threads/:threadId/read        (dm.oversee)
//   reviewDmFlag           POST /api/ops/dm/flags/:flagId/review          (dm.oversee)
//   initiateDmSuspension   POST /api/ops/dm/suspensions                   (dm.suspend_guardian_visibility)
//   acknowledgeDmSuspension POST /api/ops/dm/suspensions/:id/acknowledge  (dm.acknowledge_visibility_suspension)

/** A query value may arrive as a single string or (repeatable) an array. */
type QueryValue = string | string[] | undefined

export interface ReadDmQueueInput extends AuthedInputBase {
  query?: Record<string, QueryValue>
}

/**
 * GET /api/ops/dm/queue?chapterId=… — the safety officer's FULL-COVERAGE reading
 * queue for their chapter (design C.6): the complete chronological, decrypted queue
 * with flags pinned + per-thread coverage + the weekly-volume threshold flag. GET
 * (read-exempt from the manifest); it LOGS officer reads to the monitoring ledger,
 * which is the existing read-logging precedent for a GET. Dark-gated. A non-officer
 * / another chapter's officer gets an opaque 403 from `dm.oversee`.
 */
export function readDmQueue(input: ReadDmQueueInput): Promise<ControllerResult<DmReadingQueue>> {
  return runAuthed(input, async (ctx, sql) => {
    const chapterId = reqStr(optStr(input.query?.chapterId), 'chapterId')
    const now = input.now ?? new Date()
    const result = await new DmOversightService({ sql, authorize }).readingQueue(chapterId, ctx, now)
    return { status: 200, body: result }
  })
}

export interface ReadDmOversightReportInput extends AuthedInputBase {
  query?: Record<string, QueryValue>
}

/**
 * GET /api/ops/dm/oversight-report?chapterId=&from=&to= — the QUARTERLY
 * officer-oversight export for the board (design C.7): coverage, flags raised +
 * disposition, suspensions, review counts over the window. GET (read-exempt), dark-
 * gated, gated on `dm.oversee`.
 */
export function readDmOversightReport(
  input: ReadDmOversightReportInput,
): Promise<ControllerResult<DmOversightReport>> {
  return runAuthed(input, async (ctx, sql) => {
    const chapterId = reqStr(optStr(input.query?.chapterId), 'chapterId')
    const from = new Date(reqStr(optStr(input.query?.from), 'from'))
    const to = new Date(reqStr(optStr(input.query?.to), 'to'))
    const result = await new DmOversightService({ sql, authorize }).oversightReport({ chapterId, from, to }, ctx)
    return { status: 200, body: result }
  })
}

export interface MarkDmThreadReadInput extends AuthedInputBase {
  params: { threadId?: unknown }
}

/** POST /api/ops/dm/threads/:threadId/read — record a read-receipt to the latest seq (dm.oversee). */
export function markDmThreadRead(
  input: MarkDmThreadReadInput,
): Promise<ControllerResult<{ receiptId: string; upToSeq: string }>> {
  return runAuthed(input, async (ctx, sql) => {
    const threadId = reqStr(input.params?.threadId, 'threadId')
    const now = input.now ?? new Date()
    const result = await new DmOversightService({ sql, authorize }).markThreadRead(threadId, ctx, now)
    return { status: 201, body: result }
  })
}

export interface ReviewDmFlagInput extends AuthedInputBase {
  params: { flagId?: unknown }
  body: { disposition?: unknown; note?: unknown }
}

/** POST /api/ops/dm/flags/:flagId/review — record a safety-officer flag disposition (dm.oversee). */
export function reviewDmFlag(input: ReviewDmFlagInput): Promise<ControllerResult<{ reviewId: string }>> {
  return runAuthed(input, async (ctx, sql) => {
    const flagId = reqStr(input.params?.flagId, 'flagId')
    const disposition = reqStr(input.body?.disposition, 'disposition')
    const now = input.now ?? new Date()
    const result = await new DmOversightService({ sql, authorize }).reviewFlag(flagId, disposition, ctx, {
      note: optStr(input.body?.note),
      now,
    })
    return { status: 201, body: result }
  })
}

export interface InitiateDmSuspensionInput extends AuthedInputBase {
  body: { studentAccountId?: unknown; chapterId?: unknown; threadId?: unknown; reason?: unknown }
}

/**
 * POST /api/ops/dm/suspensions — the safety officer INITIATES a guardian-visibility
 * suspension (dm.suspend_guardian_visibility). Requires a recorded reason; returns
 * the mandatory-reporter checkpoint content (design C.8). It does not take effect
 * until a second adult acknowledges.
 */
export function initiateDmSuspension(
  input: InitiateDmSuspensionInput,
): Promise<ControllerResult<DmSuspensionInitiateResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const now = input.now ?? new Date()
    const result = await new DmVisibilitySuspensionService({ sql, authorize }).initiate(
      {
        studentAccountId: reqStr(input.body?.studentAccountId, 'studentAccountId'),
        chapterId: reqStr(input.body?.chapterId, 'chapterId'),
        threadId: optStr(input.body?.threadId),
        reason: reqStr(input.body?.reason, 'reason'),
      },
      ctx,
      now,
    )
    return { status: 201, body: result }
  })
}

export interface AcknowledgeDmSuspensionInput extends AuthedInputBase {
  params: { id?: unknown }
}

/**
 * POST /api/ops/dm/suspensions/:id/acknowledge — the SECOND adult acknowledges,
 * bringing the suspension into effect (dm.acknowledge_visibility_suspension). The
 * service enforces that the acknowledger is not a mentor in the chapter and is
 * distinct from the initiating officer (design C.8).
 */
export function acknowledgeDmSuspension(
  input: AcknowledgeDmSuspensionInput,
): Promise<ControllerResult<{ acknowledged: true }>> {
  return runAuthed(input, async (ctx, sql) => {
    const suspensionId = reqStr(input.params?.id, 'id')
    const now = input.now ?? new Date()
    const result = await new DmVisibilitySuspensionService({ sql, authorize }).acknowledge(suspensionId, ctx, now)
    return { status: 201, body: result }
  })
}

// ---- Phase 4: participant & guardian surfaces (design C.2, C.10, C.12) ------
// All DARK behind MENTOR_DM_ENABLED — the services refuse with the flag off.
//
//   sendDmMessage      POST /api/dm/messages                       (dm.message)
//   listDmThreads      GET  /api/dm/threads                        (participant; GET read-exempt)
//   readDmThread       GET  /api/dm/threads/:threadId              (party-gated; GET read-exempt)
//   getDmOnboarding    GET  /api/dm/onboarding                     (participant; GET read-exempt)
//   ackDmOnboarding    POST /api/dm/onboarding/ack                 (dm.read_own)
//   reportDmThread     POST /api/dm/threads/:threadId/report       (dm.report)
//   listDmReports      GET  /api/ops/dm/reports                    (dm.oversee; GET read-exempt)
//   readChildDm        GET  /api/guardian/children/:id/dm          (guardian-scoped; GET read-exempt)
//   readChildDmDigest  GET  /api/guardian/children/:id/dm/digest   (guardian-scoped; GET read-exempt)

export interface SendDmMessageInput extends AuthedInputBase {
  body: { mentorMembershipId?: unknown; studentAccountId?: unknown; chapterId?: unknown; body?: unknown }
}

/**
 * POST /api/dm/messages — a participant (a mentor OR the student) sends within an
 * AUTHORIZED pair (design C.2; dm.message). The service resolves the pair and
 * enforces canDirectMessage (assignment + mentor_dm consent + eligibility + chapter
 * switch + the global flag) + the closed-hours + frozen + content-flag checks, stores
 * the ENCRYPTED body, and returns the created message. Dark-gated.
 */
export function sendDmMessage(
  input: SendDmMessageInput,
): Promise<ControllerResult<{ threadId: string; messageId: string }>> {
  return runAuthed(input, async (ctx, sql) => {
    const now = input.now ?? new Date()
    const result = await new DmThreadService({ sql, authorize }).sendMessage(
      {
        mentorMembershipId: reqStr(input.body?.mentorMembershipId, 'mentorMembershipId'),
        studentAccountId: reqStr(input.body?.studentAccountId, 'studentAccountId'),
        chapterId: reqStr(input.body?.chapterId, 'chapterId'),
        body: reqStr(input.body?.body, 'body'),
      },
      ctx,
      now,
    )
    return { status: 201, body: result }
  })
}

/**
 * GET /api/dm/threads — the caller's OWN threads (design C.2): a student sees their
 * thread(s); a mentor sees the pairs they are assigned. Each item carries the
 * permanent visibility header + the who-can-read statement. GET (read-exempt),
 * dark-gated.
 */
export function listDmThreads(input: AuthedInputBase): Promise<ControllerResult<{ items: DmThreadListItem[] }>> {
  return runAuthed(input, async (ctx, sql) => {
    const now = input.now ?? new Date()
    const result = await new DmParticipantService({ sql, authorize }).listThreads(ctx.account.id, now)
    return { status: 200, body: result }
  })
}

export interface ReadDmThreadInput extends AuthedInputBase {
  params: { threadId?: unknown }
}

/**
 * GET /api/dm/threads/:threadId — one thread with its decrypted messages (design
 * C.2), gated by the suspension-aware four-party party check (a suspended guardian is
 * excluded; participants + safety officer + non-suspended guardian admitted). The
 * payload INCLUDES the permanent visibility header + the who-can-read statement. GET
 * (read-exempt), dark-gated.
 */
export function readDmThread(input: ReadDmThreadInput): Promise<ControllerResult<DmThreadDetail>> {
  return runAuthed(input, async (ctx, sql) => {
    const threadId = reqStr(input.params?.threadId, 'threadId')
    const now = input.now ?? new Date()
    const result = await new DmParticipantService({ sql, authorize }).readThread(threadId, ctx.account.id, now)
    return { status: 200, body: result }
  })
}

/**
 * GET /api/dm/onboarding — the first-open onboarding screen content + whether this
 * student has acknowledged it (design C.12). GET (read-exempt), dark-gated.
 */
export function getDmOnboarding(input: AuthedInputBase): Promise<ControllerResult<DmOnboardingView>> {
  return runAuthed(input, async (ctx, sql) => {
    const result = await new DmParticipantService({ sql, authorize }).getOnboarding(ctx.account.id)
    return { status: 200, body: result }
  })
}

/**
 * POST /api/dm/onboarding/ack — record the student's first-open onboarding
 * acknowledgement (design C.12; dm.read_own). Idempotent. Dark-gated.
 */
export function ackDmOnboarding(
  input: AuthedInputBase,
): Promise<ControllerResult<{ acknowledged: true; acknowledgedAt: string }>> {
  return runAuthed(input, async (ctx, sql) => {
    const now = input.now ?? new Date()
    const result = await new DmParticipantService({ sql, authorize }).acknowledgeOnboarding(ctx, now)
    return { status: 201, body: result }
  })
}

export interface ReportDmThreadInput extends AuthedInputBase {
  params: { threadId?: unknown }
  body: { note?: unknown }
}

/**
 * POST /api/dm/threads/:threadId/report — a participant files a low-key "something
 * feels off" report (design C.12; dm.report) that routes to the SAFETY OFFICER and
 * does NOT notify the mentor. The service writes an append-only dm_report + a
 * dm.student_report monitoring-ledger entry; nothing appears on the thread. Gated by
 * the party check on top of dm.report. Dark-gated.
 */
export function reportDmThread(
  input: ReportDmThreadInput,
): Promise<ControllerResult<{ reportId: string; threadId: string }>> {
  return runAuthed(input, async (ctx, sql) => {
    const threadId = reqStr(input.params?.threadId, 'threadId')
    const now = input.now ?? new Date()
    const result = await new DmParticipantService({ sql, authorize }).reportThread(
      threadId,
      ctx,
      { note: optStr(input.body?.note) },
      now,
    )
    return { status: 201, body: result }
  })
}

/**
 * GET /api/ops/dm/reports?chapterId=… — the safety officer's view of the student
 * reports in their chapter (design C.12; dm.oversee). The report "routes to the safety
 * officer's view": this is it. A non-officer / the mentor gets an opaque 403. GET
 * (read-exempt), dark-gated.
 */
export function listDmReports(input: ReadDmQueueInput): Promise<ControllerResult<{ items: DmReportView[] }>> {
  return runAuthed(input, async (ctx, sql) => {
    const chapterId = reqStr(optStr(input.query?.chapterId), 'chapterId')
    const now = input.now ?? new Date()
    const result = await new DmParticipantService({ sql, authorize }).listReports(chapterId, ctx, now)
    return { status: 200, body: result }
  })
}

export interface ReadChildDmInput extends AuthedInputBase {
  params: { id?: unknown }
}

/**
 * GET /api/guardian/children/:id/dm — a verified guardian reads their OWN child's DM
 * threads (decrypted), UNLESS an active visibility suspension excludes them (design
 * C.10; suspension-aware via the party check). Another child / a lapsed edge is an
 * opaque 403. GET (read-exempt), dark-gated.
 */
export function readChildDm(input: ReadChildDmInput): Promise<ControllerResult<{ items: DmThreadDetail[] }>> {
  return runAuthed(input, async (ctx, sql) => {
    const childId = reqStr(input.params?.id, 'id')
    const now = input.now ?? new Date()
    const result = await new DmGuardianDmService({ sql }).listChildThreads(ctx.account.id, childId, now)
    return { status: 200, body: result }
  })
}

/**
 * GET /api/guardian/children/:id/dm/digest — the weekly digest DATA for the
 * guardian's OWN child (design C.10): thread count, message count since the last
 * digest, and any flags on that child's threads. The email itself is frontend-owned
 * (Resend); this exposes the data. Another child is an opaque 403. GET (read-exempt),
 * dark-gated.
 */
export function readChildDmDigest(input: ReadChildDmInput): Promise<ControllerResult<DmChildDigest>> {
  return runAuthed(input, async (ctx, sql) => {
    const childId = reqStr(input.params?.id, 'id')
    const now = input.now ?? new Date()
    const result = await new DmGuardianDmService({ sql }).childDigest(ctx.account.id, childId, now)
    return { status: 200, body: result }
  })
}
