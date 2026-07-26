// -------------------------------------------------------------------------
// Consent-form catalog controllers (director portal "Consent Forms"). Thin
// adapters over the framework-agnostic ConsentFormAdminService: resolve the
// session to an AuthContext (runAuthed), then call the service, which gates the
// chapter-scoped consent.form.read / consent.form.manage through the injected
// `authorize`. A null session is an opaque 403 (runAuthed); a cross-chapter /
// non-director caller is an opaque 403 from the service's authorize.
//
//   listConsentForms      GET /api/ops/consent-forms              (consent.form.read)
//   getConsentFormDetail  GET /api/ops/consent-forms/:key         (consent.form.read)
//   getEditableConsentForm GET /api/ops/consent-forms/:key/editable (consent.form.manage)
//   getConsentFormPdf     GET /api/ops/consent-forms/:key/pdf      (consent.form.read)
//   saveConsentForm       PUT /api/ops/consent-forms/:key         (consent.form.manage)
//
// Only the PUT is a mutating route (manifested; the GETs are read-exempt).
// -------------------------------------------------------------------------

import {
  ConsentFormAdminService,
  FormNotFoundError,
  type ConsentFormSummary,
  type ConsentFormDetail,
  type EditableForm,
  type ConsentFormSaveResult,
  type ConsentFormSaveInput,
} from '@curiolab/app'
import { authorize } from '@curiolab/runtime'
import { runAuthed } from '../run.js'
import { reqStr } from '../respond.js'
import type { AuthedInputBase, ControllerResult } from '../types.js'

/** A bare list envelope (kept symmetric with the ops-read list controllers). */
interface ListEnvelope<T> {
  items: T[]
}

type QueryValue = string | string[] | null | undefined

export interface ConsentFormKeyInput extends AuthedInputBase {
  params: { key?: unknown }
  query?: Record<string, QueryValue>
}
/** Legacy alias kept for the Phase-1 GET-detail controller. */
export type ConsentFormDetailInput = ConsentFormKeyInput

export interface ConsentFormPutInput extends ConsentFormKeyInput {
  body: Record<string, unknown>
}

/** The raw PDF response (bytes + headers), returned to the Next route adapter. */
export interface ConsentFormPdfResult {
  status: number
  bytes: Buffer
  contentType: string
  sha256: string
}

/** GET /api/ops/consent-forms — the consent-form summaries (consent.form.read). */
export function listConsentForms(
  input: AuthedInputBase,
): Promise<ControllerResult<ListEnvelope<ConsentFormSummary>>> {
  return runAuthed(input, async (ctx, sql) => {
    const items = await new ConsentFormAdminService({ sql, authorize }).listForms(ctx)
    return { status: 200, body: { items } }
  })
}

/** GET /api/ops/consent-forms/:key — one form's resolved detail (consent.form.read); 404 if unknown. */
export function getConsentFormDetail(
  input: ConsentFormKeyInput,
): Promise<ControllerResult<ConsentFormDetail>> {
  return runAuthed(input, async (ctx, sql) => {
    const key = reqStr(input.params?.key, 'key')
    const detail = await new ConsentFormAdminService({ sql, authorize }).getForm(key, ctx)
    if (detail === null) throw new FormNotFoundError(key)
    return { status: 200, body: detail }
  })
}

/** GET /api/ops/consent-forms/:key/editable — the editor definition (consent.form.manage). */
export function getEditableConsentForm(
  input: ConsentFormKeyInput,
): Promise<ControllerResult<EditableForm>> {
  return runAuthed(input, async (ctx, sql) => {
    const key = reqStr(input.params?.key, 'key')
    const editable = await new ConsentFormAdminService({ sql, authorize }).getEditable(
      key,
      ctx,
      firstQuery(input.query?.chapterId),
    )
    return { status: 200, body: editable }
  })
}

/** PUT /api/ops/consent-forms/:key — save a new version (consent.form.manage). */
export function saveConsentForm(
  input: ConsentFormPutInput,
): Promise<ControllerResult<ConsentFormSaveResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const key = reqStr(input.params?.key, 'key')
    const body = input.body ?? {}
    const saveInput: ConsentFormSaveInput = {
      formKey: key,
      audience: body.audience as ConsentFormSaveInput['audience'],
      title: typeof body.title === 'string' ? body.title : '',
      documentId: typeof body.documentId === 'string' ? body.documentId : '',
      elevated: body.elevated === true,
      items: Array.isArray(body.items) ? (body.items as ConsentFormSaveInput['items']) : [],
      fields: Array.isArray(body.fields) ? (body.fields as ConsentFormSaveInput['fields']) : [],
      pdfBase64: typeof body.pdfBase64 === 'string' ? body.pdfBase64 : undefined,
      publish: body.publish === true,
    }
    const result = await new ConsentFormAdminService({ sql, authorize }).saveForm(
      ctx,
      saveInput,
      firstQuery(input.query?.chapterId),
    )
    return { status: 200, body: result }
  })
}

/**
 * GET /api/ops/consent-forms/:key/pdf — the form's PDF bytes (consent.form.read).
 * Returns the raw bytes (not JSON) for the Next route to stream; a null session
 * or an authorize deny surfaces as a 403 with no body.
 */
export async function getConsentFormPdf(input: ConsentFormKeyInput): Promise<ConsentFormPdfResult> {
  const result = await runAuthed<ConsentFormPdfResult>(input, async (ctx, sql) => {
    const key = reqStr(input.params?.key, 'key')
    const version = parseVersion(input.query?.v)
    const pdf = await new ConsentFormAdminService({ sql, authorize }).getFormPdf(key, ctx, version)
    return {
      status: 200,
      body: { status: 200, bytes: pdf.bytes, contentType: pdf.contentType, sha256: pdf.sha256 },
    }
  })
  // runAuthed wraps the payload in { status, body }; unwrap for the raw-bytes route.
  // A non-200 (403/404) carries no bytes.
  if (result.status === 200 && result.body != null) return result.body
  return { status: result.status, bytes: Buffer.alloc(0), contentType: 'application/pdf', sha256: '' }
}

function firstQuery(v: QueryValue): string | null {
  if (Array.isArray(v)) return v[0] ?? null
  return v == null ? null : String(v)
}

function parseVersion(v: QueryValue): number | undefined {
  const raw = firstQuery(v)
  if (raw === null || raw === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}
