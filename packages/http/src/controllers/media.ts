// -------------------------------------------------------------------------
// Media ops controllers (05-api-surface.md "Operations back office": POST
// /ops/media/:id/{confirm-depiction,clear,remove}, media.review; plus the
// student attach). attach is gated by project.submit (own scope, student role);
// confirm/clear/remove by media.review (mentor/staff). Each resolves the session
// to an AuthContext and calls MediaService under `authorize`.
//
//   attachMedia       POST /api/ops/media                      (project.submit, own)
//   confirmDepiction  POST /api/ops/media/:id/confirm-depiction (media.review)
//   clearMedia        POST /api/ops/media/:id/clear            (media.review)
//   removeMedia       POST /api/ops/media/:id/remove           (media.review)
// -------------------------------------------------------------------------

import {
  MediaService,
  type AttachDepictionInput,
  type AttachMediaResult,
  type ConfirmDepictionResult,
  type MediaReviewResult,
} from '@curiolab/app'
import { authorize } from '@curiolab/runtime'
import { runAuthed } from '../run.js'
import { ValidationError, reqStr } from '../respond.js'
import type { AuthedInputBase, ControllerResult } from '../types.js'

// ---- Attach ---------------------------------------------------------------

export interface AttachMediaInputHttp extends AuthedInputBase {
  body: { projectId?: unknown; storageRef?: unknown; depictions?: unknown }
}

/** Parse the optional depiction hints (each `{ accountId }`); a bad shape is a 400. */
function parseDepictions(raw: unknown): AttachDepictionInput[] {
  if (raw == null) return []
  if (!Array.isArray(raw)) throw new ValidationError('depictions must be an array')
  return raw.map((d) => {
    if (d === null || typeof d !== 'object') throw new ValidationError('invalid depiction')
    return { accountId: reqStr((d as Record<string, unknown>).accountId, 'depictions[].accountId') }
  })
}

/** POST /api/ops/media — attach media to the actor's own project (project.submit, own). */
export function attachMedia(
  input: AttachMediaInputHttp,
): Promise<ControllerResult<AttachMediaResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const result = await new MediaService({ sql, authorize }).attach(
      {
        projectId: reqStr(input.body?.projectId, 'projectId'),
        storageRef: reqStr(input.body?.storageRef, 'storageRef'),
        depictions: parseDepictions(input.body?.depictions),
      },
      ctx,
    )
    return { status: 201, body: result }
  })
}

// ---- Reviewer actions -----------------------------------------------------

export interface ConfirmDepictionInputHttp extends AuthedInputBase {
  params: { id?: unknown }
  body: { accountId?: unknown }
}

/** POST /api/ops/media/:id/confirm-depiction — authoritatively tag a depicted account (media.review). */
export function confirmDepiction(
  input: ConfirmDepictionInputHttp,
): Promise<ControllerResult<ConfirmDepictionResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const mediaId = reqStr(input.params?.id, 'id')
    const accountId = reqStr(input.body?.accountId, 'accountId')
    const result = await new MediaService({ sql, authorize }).confirmDepiction(mediaId, accountId, ctx)
    return { status: 200, body: result }
  })
}

export interface MediaIdInput extends AuthedInputBase {
  params: { id?: unknown }
}

/** POST /api/ops/media/:id/clear — clear for photo_media-gated public use (media.review). */
export function clearMedia(input: MediaIdInput): Promise<ControllerResult<MediaReviewResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const mediaId = reqStr(input.params?.id, 'id')
    const result = await new MediaService({ sql, authorize }).clear(mediaId, ctx)
    return { status: 200, body: result }
  })
}

/** POST /api/ops/media/:id/remove — terminal removed (media.review). */
export function removeMedia(input: MediaIdInput): Promise<ControllerResult<MediaReviewResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const mediaId = reqStr(input.params?.id, 'id')
    const result = await new MediaService({ sql, authorize }).remove(mediaId, ctx)
    return { status: 200, body: result }
  })
}
