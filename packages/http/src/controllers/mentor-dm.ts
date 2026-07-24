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
  DmThreadService,
  SafetyOfficerService,
  type DmDraftCheckResult,
  type DmThreadExport,
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
