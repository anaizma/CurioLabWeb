// -------------------------------------------------------------------------
// Application-form definition controllers (application-form-definition-spec.md).
// Thin adapters over the framework-agnostic ApplicationFormService: resolve the
// session to an AuthContext (runAuthed), then call the service, which gates the
// capability through the injected `authorize` and reads/writes one row set.
//
//   getApplicationForm  GET /api/ops/application-form  (application.read)
//   putApplicationForm  PUT /api/ops/application-form  (application.form.manage)
//
// GET returns { chapterId, version, status, definition }; PUT takes
// { definition, publish? } and returns { chapterId, version, status, definition }.
// A validation failure is a 400 (ApplicationFormValidationError -> BAD_REQUEST);
// a deny is an opaque 403.
// -------------------------------------------------------------------------

import { ApplicationFormService, type StoredForm } from '@curiolab/app'
import { authorize } from '@curiolab/runtime'
import { runAuthed } from '../run.js'
import { optStr, reqObj } from '../respond.js'
import type { AuthedInputBase, ControllerResult } from '../types.js'

type QueryValue = string | string[] | null | undefined

export interface ApplicationFormGetInput extends AuthedInputBase {
  query?: Record<string, QueryValue>
}

export interface ApplicationFormPutInput extends AuthedInputBase {
  query?: Record<string, QueryValue>
  body: { definition?: unknown; publish?: unknown; chapterId?: unknown }
}

function chapterIdOf(query: Record<string, QueryValue> | undefined, bodyChapterId?: unknown): string | null {
  const fromBody = bodyChapterId == null ? null : String(bodyChapterId)
  return fromBody ?? optStr(query?.chapterId)
}

/** GET /api/ops/application-form — the caller's chapter's current form (application.read). */
export function getApplicationForm(
  input: ApplicationFormGetInput,
): Promise<ControllerResult<StoredForm>> {
  return runAuthed(input, async (ctx, sql) => {
    const result = await new ApplicationFormService({ sql, authorize }).getForm(
      ctx,
      optStr(input.query?.chapterId),
    )
    return { status: 200, body: result }
  })
}

/** PUT /api/ops/application-form — save a new version (application.form.manage). */
export function putApplicationForm(
  input: ApplicationFormPutInput,
): Promise<ControllerResult<StoredForm>> {
  return runAuthed(input, async (ctx, sql) => {
    // `definition` must be an object; publish is an optional boolean.
    const definition = reqObj(input.body?.definition, 'definition')
    const publish = input.body?.publish === true
    const result = await new ApplicationFormService({ sql, authorize }).saveForm(
      ctx,
      { definition, publish },
      chapterIdOf(input.query, input.body?.chapterId),
    )
    return { status: 200, body: result }
  })
}
