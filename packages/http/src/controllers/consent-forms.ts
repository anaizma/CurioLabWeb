import { ConsentFormService, type FormSubmitPayload } from '@curiolab/app'
import { authorize } from '@curiolab/runtime'
import { runAuthed } from '../run.js'
import { reqStr, ValidationError } from '../respond.js'
import type { AuthedInputBase, ControllerResult } from '../types.js'

/** The raw PDF response (bytes + headers), returned to the Next route adapter. */
export interface ChildFormPdfResult {
  status: number
  bytes: Buffer
  contentType: string
  sha256: string
}

export interface ChildFormsInput extends AuthedInputBase { params: { id?: unknown } }
export type SavedFieldsInput = AuthedInputBase
export interface DraftInput extends AuthedInputBase { params: { id?: unknown; formId?: unknown }; body?: unknown }
export interface SubmitInput extends AuthedInputBase { params: { id?: unknown; formId?: unknown }; body: unknown }

export function listChildForms(input: ChildFormsInput): Promise<ControllerResult<{ items: unknown[] }>> {
  return runAuthed(input, async (ctx, sql) => {
    const childId = reqStr(input.params?.id, 'id')
    const items = await new ConsentFormService({ sql, authorize: authorize as never }).listForms(childId, ctx)
    return { status: 200, body: { items } }
  })
}

/**
 * GET /api/guardian/children/:id/forms/:formId/pdf — the bytes the guardian
 * reads and binds their completion to (the published override, else the
 * catalog). Returns raw bytes for the Next route to stream; a null session or an
 * authorize deny carries no bytes.
 */
export async function getChildFormPdf(input: DraftInput): Promise<ChildFormPdfResult> {
  const result = await runAuthed<ChildFormPdfResult>(input, async (ctx, sql) => {
    const childId = reqStr(input.params?.id, 'id'); const formId = reqStr(input.params?.formId, 'formId')
    const pdf = await new ConsentFormService({ sql, authorize: authorize as never }).getFormPdf(childId, formId, ctx)
    return { status: 200, body: { status: 200, bytes: pdf.bytes, contentType: 'application/pdf', sha256: pdf.sha256 } }
  })
  if (result.status === 200 && result.body != null) return result.body
  return { status: result.status, bytes: Buffer.alloc(0), contentType: 'application/pdf', sha256: '' }
}

export function getSavedFields(input: SavedFieldsInput): Promise<ControllerResult<unknown>> {
  return runAuthed(input, async (ctx, sql) => {
    const body = await new ConsentFormService({ sql, authorize: authorize as never }).getSavedFields(ctx)
    return { status: 200, body }
  })
}

export function getFormDraft(input: DraftInput): Promise<ControllerResult<unknown>> {
  return runAuthed(input, async (ctx, sql) => {
    const childId = reqStr(input.params?.id, 'id'); const formId = reqStr(input.params?.formId, 'formId')
    const body = await new ConsentFormService({ sql, authorize: authorize as never }).getDraft(childId, formId, ctx)
    return { status: 200, body: body ?? {} }
  })
}

export function saveFormDraft(input: DraftInput): Promise<ControllerResult<{ ok: true }>> {
  return runAuthed(input, async (ctx, sql) => {
    const childId = reqStr(input.params?.id, 'id'); const formId = reqStr(input.params?.formId, 'formId')
    await new ConsentFormService({ sql, authorize: authorize as never }).saveDraft(childId, formId, ctx, input.body as FormSubmitPayload)
    return { status: 200, body: { ok: true } }
  })
}

export function submitFormCompletion(input: SubmitInput): Promise<ControllerResult<{ completionId: string }>> {
  return runAuthed(input, async (ctx, sql) => {
    const childId = reqStr(input.params?.id, 'id'); const formId = reqStr(input.params?.formId, 'formId')
    const b = input.body as Partial<FormSubmitPayload>
    if (!b || typeof b !== 'object' || !b.itemStates || !b.pdfSha256) throw new ValidationError('malformed submission')
    const res = await new ConsentFormService({ sql, authorize: authorize as never }).submitCompletion(childId, formId, ctx, b as FormSubmitPayload)
    return { status: 201, body: { completionId: res.completionId } }
  })
}
