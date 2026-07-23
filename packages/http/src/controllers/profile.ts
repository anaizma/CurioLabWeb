// -------------------------------------------------------------------------
// Student profile controllers (05-api-surface.md "Student profile and
// projects"). Each authed mutation/read resolves the session to an AuthContext
// and calls its service under `authorize`; a deny surfaces as an opaque 403 with
// one permission.denied audit row (owned by the runtime layer).
//
//   viewProfile                  GET   /api/profile/:id                (profile.view / student.view_record)
//   editNarrative                PATCH /api/profile/narrative          (profile.edit_narrative, own)
//   reviewNarrative              POST  /api/profile/narrative/:id/review (narrative.review)
//   regenerateVerificationToken  POST  /api/profile/verification-token (verification.regenerate)
//
// The public verify URL (GET /api/verify/:token) lives in controllers/verify.ts.
// -------------------------------------------------------------------------

import {
  ProfileService,
  VerificationService,
  type EditNarrativeResult,
  type NarrativeStatusResult,
  type ProfileView,
  type RegenerateVerificationResult,
} from '@curiolab/app'
import { authorize } from '@curiolab/runtime'
import { runAuthed } from '../run.js'
import { optStr, reqStr } from '../respond.js'
import type { AuthedInputBase, ControllerResult } from '../types.js'

// ---- Profile view ---------------------------------------------------------

export interface ViewProfileInput extends AuthedInputBase {
  params: { id?: unknown }
}

/** GET /api/profile/:id — the composed verified record + published narrative. */
export function viewProfile(
  input: ViewProfileInput,
): Promise<ControllerResult<ProfileView>> {
  return runAuthed<ProfileView>(input, async (ctx, sql) => {
    const subjectAccountId = reqStr(input.params?.id, 'id')
    const view = await new ProfileService({ sql, authorize }).view(subjectAccountId, ctx)
    return { status: 200, body: view as ProfileView }
  })
}

// ---- Narrative edit / review ----------------------------------------------

export interface EditNarrativeInput extends AuthedInputBase {
  body: { body?: unknown }
}

/**
 * PATCH /api/profile/narrative — profile.edit_narrative (own). The subject is
 * the actor; a minor's edit lands `pending_review`, an adult's publishes.
 */
export function editNarrative(
  input: EditNarrativeInput,
): Promise<ControllerResult<EditNarrativeResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const body = reqStr(input.body?.body, 'body')
    const result = await new ProfileService({ sql, authorize }).editNarrative(ctx.account.id, body, ctx)
    return { status: 200, body: result }
  })
}

export interface ReviewNarrativeInput extends AuthedInputBase {
  params: { id?: unknown }
}

/** POST /api/profile/narrative/:id/review — narrative.review (pending_review -> published). */
export function reviewNarrative(
  input: ReviewNarrativeInput,
): Promise<ControllerResult<NarrativeStatusResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const narrativeId = reqStr(input.params?.id, 'id')
    const result = await new ProfileService({ sql, authorize }).reviewNarrative(narrativeId, ctx)
    return { status: 200, body: result }
  })
}

// ---- Verification token regenerate ----------------------------------------

export interface RegenerateVerificationTokenInput extends AuthedInputBase {
  /** Optional subject; defaults to the actor (self). A guardian may name their child. */
  body?: { subjectAccountId?: unknown }
}

/**
 * POST /api/profile/verification-token — verification.regenerate (own or
 * guardian). Revokes the prior live token and returns a fresh plaintext once.
 */
export function regenerateVerificationToken(
  input: RegenerateVerificationTokenInput,
): Promise<ControllerResult<RegenerateVerificationResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const subjectAccountId = optStr(input.body?.subjectAccountId) ?? ctx.account.id
    const result = await new VerificationService({ sql, authorize }).regenerate(subjectAccountId, ctx)
    return { status: 201, body: result }
  })
}
