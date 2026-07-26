import { ConsentFormService, type FormSubmitPayload } from '@curiolab/app'
import { authorize } from '@curiolab/runtime'
import { runAuthed } from '../run.js'
import { reqStr, ValidationError } from '../respond.js'
import type { AuthedInputBase, ControllerResult } from '../types.js'

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
