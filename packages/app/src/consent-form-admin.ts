// -------------------------------------------------------------------------
// ConsentFormAdminService — the director-editable consent forms (Phase 2a). A
// chapter director inspects and EDITS the guardian/mentor/student consent forms
// their chapter uses: the display PDF, the parsed checkbox items, and the curated
// detail fields. This is the WRITE + read-overlay + PDF-serve backend layered on
// Phase 1's read-only catalog view.
//
//   GET  /api/ops/consent-forms              (consent.form.read)   -> listForms
//   GET  /api/ops/consent-forms/:key         (consent.form.read)   -> getForm
//   GET  /api/ops/consent-forms/:key/editable(consent.form.manage) -> getEditable
//   GET  /api/ops/consent-forms/:key/pdf     (consent.form.read)   -> getFormPdf
//   PUT  /api/ops/consent-forms/:key         (consent.form.manage) -> saveForm
//
// READ OVERLAY (listForms / getForm): DB-published-override-catalog. For each
// form_key, the highest-version PUBLISHED consent_form row for the director's
// chapter wins (source 'chapter'); else the highest-version published platform
// default (chapter_id NULL, source 'platform'); else the static catalog (source
// 'catalog'). An empty consent_form table therefore reads the catalog unchanged.
//
// WRITE (saveForm): mirrors ApplicationFormService.saveForm — validate, bump the
// per-(chapter,form_key) version, INSERT a NEW row (append-only; never mutate a
// published one), publish when `publish` is true, and write the audit row. The
// PDF is CARRIED from the latest chapter row (or the committed catalog file) when
// no `pdfBase64` is supplied, so a metadata edit need not re-upload the document.
//
// Framework-agnostic: the db handle and `authorize` are injected. The catalog
// PDFs are committed at <repo>/public/consent-forms/<formKey>.pdf; the service
// reads them by walking up from process.cwd()/the module dir to the repo root.
// -------------------------------------------------------------------------

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Sql, JSONValue } from 'postgres'
import type { AuthContext, Resource } from '@curiolab/core'
import { assertAuthorized, writeAudit, type AuthorizeDeps } from '@curiolab/runtime'
import { CATALOG } from './consent-forms/catalog.js'
import type { CatalogForm, CatalogItem, FormAudience } from './consent-forms/types.js'
import { GRANT_RENEWAL_MS_BY_TYPE, type ConsentGrantType } from './config.js'
import { ConsentFormValidationError, FormNotFoundError } from './errors.js'

export type ConsentFormAdminCapability = 'consent.form.read' | 'consent.form.manage'
export type ConsentFormSource = 'catalog' | 'platform' | 'chapter'

/** The detail-field input types a director may pick (adds `signature` to the client set). */
export type EditableFieldInputType = 'text' | 'date' | 'tel' | 'email' | 'signature'

/** One editable detail field. `fixed` marks a locked default (removable=false). */
export interface EditableField {
  fieldType: string
  label: string
  inputType: EditableFieldInputType
  required: boolean
  fixed?: boolean
}

export type ConsentFormAdminAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: ConsentFormAdminCapability,
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface ConsentFormAdminServiceDeps {
  sql: Sql
  authorize: ConsentFormAdminAuthorizeFn
}

/** One row in the director's grouped consent-form list. */
export interface ConsentFormSummary {
  formKey: string
  audience: FormAudience
  title: string
  documentId: string
  version: string
  elevated: boolean
  itemCount: number
  fieldCount: number
  /** Legacy alias of pdfUrl (kept for the Phase-1 consumers). */
  pdfPath: string
  source: ConsentFormSource
  pdfUrl: string
}

/** The full director-facing detail of one consent form (INCLUDES grantMapping). */
export interface ConsentFormDetail {
  formKey: string
  audience: FormAudience
  title: string
  documentId: string
  version: string
  elevated: boolean
  pdfPath: string
  source: ConsentFormSource
  pdfUrl: string
  items: CatalogItem[]
  fields: EditableField[]
}

/** The CURRENT definition loaded into the editor (draft or published, else catalog). */
export interface EditableForm {
  formKey: string
  audience: FormAudience
  title: string
  documentId: string
  elevated: boolean
  items: CatalogItem[]
  fields: EditableField[]
  pdfUrl: string
  /** The highest existing chapter version (0 when materialized from the catalog). */
  version: number
  status: 'draft' | 'published'
  /** True when the latest chapter row is an unpublished draft. */
  hasDraft: boolean
}

/** The PUT payload a director saves. */
export interface ConsentFormSaveInput {
  formKey: string
  audience: FormAudience
  title: string
  documentId: string
  elevated: boolean
  items: CatalogItem[]
  fields: EditableField[]
  /** A freshly uploaded PDF (base64). Absent -> carry the current PDF bytes. */
  pdfBase64?: string
  publish: boolean
}

export interface ConsentFormSaveResult {
  formKey: string
  version: number
  status: 'draft' | 'published'
}

export interface ConsentFormPdf {
  bytes: Buffer
  sha256: string
  contentType: 'application/pdf'
}

const AUDIENCES: readonly FormAudience[] = ['guardian', 'mentor', 'student']
const FIELD_INPUT_TYPES: readonly EditableFieldInputType[] = ['text', 'date', 'tel', 'email', 'signature']
const SLUG_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/
/** The full ConsentGrantType set, derived from the renewal map so it stays in sync. */
const VALID_GRANT_TYPES = new Set<string>(Object.keys(GRANT_RENEWAL_MS_BY_TYPE))

/**
 * The locked default detail fields per audience. A director may ADD fields but
 * may not remove these; on getEditable they are marked `fixed:true`, and saveForm
 * rejects a definition missing any of them.
 */
const LOCKED_FIELDS: Record<FormAudience, readonly EditableField[]> = {
  guardian: [
    { fieldType: 'guardian_name', label: 'Guardian name', inputType: 'text', required: true, fixed: true },
    { fieldType: 'relationship', label: 'Relationship to child', inputType: 'text', required: true, fixed: true },
    { fieldType: 'date', label: 'Date', inputType: 'date', required: true, fixed: true },
    { fieldType: 'signature', label: 'Signature', inputType: 'signature', required: true, fixed: true },
  ],
  mentor: [
    { fieldType: 'mentor_name', label: 'Mentor name', inputType: 'text', required: true, fixed: true },
    { fieldType: 'date', label: 'Date', inputType: 'date', required: true, fixed: true },
    { fieldType: 'signature', label: 'Signature', inputType: 'signature', required: true, fixed: true },
  ],
  student: [
    { fieldType: 'student_name', label: 'Student name', inputType: 'text', required: true, fixed: true },
    { fieldType: 'date', label: 'Date', inputType: 'date', required: true, fixed: true },
    { fieldType: 'signature', label: 'Signature', inputType: 'signature', required: true, fixed: true },
  ],
}

/** The locked default fields for an audience (a fresh copy each call). */
export function lockedFieldsFor(audience: FormAudience): EditableField[] {
  return (LOCKED_FIELDS[audience] ?? []).map((f) => ({ ...f }))
}

/** In-force chapter_director chapters for the actor (mirrors ApplicationFormService). */
function directorChapters(ctx: AuthContext): string[] {
  return ctx.memberships
    .filter((m) => {
      if (m.role !== 'chapter_director' || m.status !== 'active') return false
      if (m.active_from !== null && m.active_from > ctx.now) return false
      if (m.active_until !== null && ctx.now >= m.active_until) return false
      return true
    })
    .map((m) => m.chapter_id)
}

function pdfUrlFor(formKey: string, version: number): string {
  return `/api/ops/consent-forms/${formKey}/pdf?v=${version}`
}

/** Recompute each field's `fixed` flag against the audience's locked set. */
function markLocked(audience: FormAudience, fields: EditableField[]): EditableField[] {
  const lockedKeys = new Set(lockedFieldsFor(audience).map((f) => f.fieldType))
  return fields.map((f) => ({ ...f, fixed: lockedKeys.has(f.fieldType) }))
}

/** Merge the audience's locked defaults into a field list, appending any missing. */
function mergeLockedFields(audience: FormAudience, fields: EditableField[]): EditableField[] {
  const present = new Set(fields.map((f) => f.fieldType))
  const merged = [...fields]
  for (const locked of lockedFieldsFor(audience)) {
    if (!present.has(locked.fieldType)) merged.push({ ...locked })
  }
  return merged
}

/** Read a committed catalog PDF (public/consent-forms/<formKey>.pdf) from the repo. */
function readCatalogPdf(formKey: string): Buffer {
  const starts = [process.cwd()]
  try {
    starts.push(dirname(fileURLToPath(import.meta.url)))
  } catch {
    /* import.meta.url unavailable (unlikely under ESM); process.cwd() suffices */
  }
  for (const start of starts) {
    let dir = start
    for (let i = 0; i < 8; i++) {
      const candidate = join(dir, 'public', 'consent-forms', `${formKey}.pdf`)
      if (existsSync(candidate)) return readFileSync(candidate)
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  throw new FormNotFoundError(formKey)
}

/** A consent_form row as the service reads it back (definition columns). */
interface ConsentFormRow {
  id: string
  form_key: string
  chapter_id: string | null
  version: number
  status: 'draft' | 'published'
  audience: FormAudience
  document_id: string | null
  title: string
  elevated: boolean
  pdf_sha256: string
  items: CatalogItem[]
  fields: EditableField[]
}

const ROW_COLS = 'id, form_key, chapter_id, version, status, audience, document_id, title, elevated, pdf_sha256, items, fields'

export class ConsentFormAdminService {
  private readonly sql: Sql
  private readonly authorize: ConsentFormAdminAuthorizeFn

  constructor(deps: ConsentFormAdminServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
  }

  // ---- reads (overlay) ----------------------------------------------------

  /**
   * GET: the consent forms as director-facing summaries, DB-published-override-
   * catalog. Chapter-scoped read (consent.form.read).
   */
  async listForms(ctx: AuthContext): Promise<ConsentFormSummary[]> {
    const chapterId = await this.authorizeReadChapter(ctx)
    const [chapterByKey, platformByKey] = await Promise.all([
      chapterId === null
        ? Promise.resolve(new Map<string, ConsentFormRow>())
        : this.publishedLatestByKey(chapterId),
      this.publishedLatestByKey(null),
    ])

    const keys = new Set<string>([
      ...CATALOG.map((c) => c.formId),
      ...chapterByKey.keys(),
      ...platformByKey.keys(),
    ])
    const out: ConsentFormSummary[] = []
    for (const key of [...keys].sort()) {
      const chRow = chapterByKey.get(key)
      const plRow = platformByKey.get(key)
      const cat = CATALOG.find((c) => c.formId === key)
      if (chRow !== undefined) out.push(summaryFromRow(chRow, 'chapter'))
      else if (plRow !== undefined) out.push(summaryFromRow(plRow, 'platform'))
      else if (cat !== undefined) out.push(summaryFromCatalog(cat))
    }
    return out
  }

  /**
   * GET: the full detail of one form (the resolved override), or null for an
   * unknown key. Chapter-scoped read (consent.form.read). INCLUDES grantMapping.
   */
  async getForm(formKey: string, ctx: AuthContext): Promise<ConsentFormDetail | null> {
    const chapterId = await this.authorizeReadChapter(ctx)
    if (chapterId !== null) {
      const chRow = await this.publishedLatest(chapterId, formKey)
      if (chRow !== undefined) return detailFromRow(chRow, 'chapter')
    }
    const plRow = await this.publishedLatest(null, formKey)
    if (plRow !== undefined) return detailFromRow(plRow, 'platform')
    const cat = CATALOG.find((c) => c.formId === formKey)
    return cat === undefined ? null : detailFromCatalog(cat)
  }

  /**
   * GET: the CURRENT definition to load into the editor — the highest-version row
   * (draft OR published) for the director's chapter, else materialized from the
   * catalog. Locked default fields are marked `fixed:true`. Chapter-scoped write
   * gate (consent.form.manage — the edit surface).
   */
  async getEditable(
    formKey: string,
    ctx: AuthContext,
    requestedChapterId?: string | null,
  ): Promise<EditableForm> {
    const chapterId = await this.resolveManageChapter(ctx, requestedChapterId)
    const row = await this.latestAny(chapterId, formKey)
    if (row !== undefined) {
      return {
        formKey,
        audience: row.audience,
        title: row.title,
        documentId: row.document_id ?? '',
        elevated: row.elevated,
        items: row.items,
        fields: markLocked(row.audience, row.fields),
        pdfUrl: pdfUrlFor(formKey, row.version),
        version: row.version,
        status: row.status,
        hasDraft: row.status === 'draft',
      }
    }
    const cat = CATALOG.find((c) => c.formId === formKey)
    if (cat === undefined) throw new FormNotFoundError(formKey)
    const fields = markLocked(cat.audience, mergeLockedFields(cat.audience, cat.fields))
    return {
      formKey,
      audience: cat.audience,
      title: cat.title,
      documentId: cat.documentId,
      elevated: cat.elevated,
      items: cat.items,
      fields,
      pdfUrl: cat.pdfPath,
      version: 0,
      status: 'draft',
      hasDraft: false,
    }
  }

  // ---- write --------------------------------------------------------------

  /**
   * PUT: validate, bump the per-(chapter,form_key) version, insert a NEW row
   * (never mutate a published one), publish when `publish` is true, carry or
   * replace the PDF, and write the audit row. Chapter-scoped write
   * (consent.form.manage). Mirrors ApplicationFormService.saveForm.
   */
  async saveForm(
    ctx: AuthContext,
    input: ConsentFormSaveInput,
    requestedChapterId?: string | null,
  ): Promise<ConsentFormSaveResult> {
    const chapterId = await this.resolveManageChapter(ctx, requestedChapterId)
    validateSaveInput(input)

    const isCatalog = CATALOG.some((c) => c.formId === input.formKey)
    const { pdf, sha256 } = await this.resolvePdf(chapterId, input, isCatalog)

    const publish = input.publish === true
    const status: 'draft' | 'published' = publish ? 'published' : 'draft'
    const fields = markLocked(input.audience, input.fields)

    return this.sql.begin(async (tx) => {
      assertAuthorized() // runtime backstop: no mutation without a recorded decision
      const [{ next }] = (await tx`
        select coalesce(max(version), 0) + 1 as next from consent_form
        where chapter_id = ${chapterId} and form_key = ${input.formKey}
      `) as unknown as [{ next: number }]
      const version = Number(next)
      const [row] = await tx`
        insert into consent_form (
          form_key, chapter_id, version, status, audience, document_id, title,
          elevated, pdf, pdf_sha256, items, fields, created_by, published_at
        ) values (
          ${input.formKey}, ${chapterId}, ${version}, ${status}, ${input.audience},
          ${input.documentId === '' ? null : input.documentId}, ${input.title},
          ${input.elevated}, ${pdf}, ${sha256},
          ${tx.json(input.items as unknown as JSONValue)},
          ${tx.json(fields as unknown as JSONValue)},
          ${ctx.account.id}, ${publish ? tx`now()` : null}
        )
        returning id, version, status
      `
      await writeAudit(tx, {
        action: publish ? 'consent.form.published' : 'consent.form.saved',
        subjectType: 'consent_form',
        subjectId: row!.id as string,
        actorAccountId: ctx.account.id,
        chapterId,
        detail: { formKey: input.formKey, version, publish },
      })
      return { formKey: input.formKey, version: Number(row!.version), status: row!.status as 'draft' | 'published' }
    }) as Promise<ConsentFormSaveResult>
  }

  // ---- pdf serve ----------------------------------------------------------

  /**
   * GET the PDF bytes for a form: the chapter's row at `version` (else the
   * platform row at that version), or the latest published row when no version is
   * given, falling back to the committed catalog file. Chapter-scoped read
   * (consent.form.read).
   */
  async getFormPdf(formKey: string, ctx: AuthContext, version?: number): Promise<ConsentFormPdf> {
    const chapterId = await this.authorizeReadChapter(ctx)
    let row: { pdf: Buffer; pdf_sha256: string } | undefined
    if (version !== undefined && Number.isFinite(version)) {
      if (chapterId !== null) row = await this.pdfAtVersion(chapterId, formKey, version)
      if (row === undefined) row = await this.pdfAtVersion(null, formKey, version)
    } else {
      if (chapterId !== null) row = await this.publishedLatestPdf(chapterId, formKey)
      if (row === undefined) row = await this.publishedLatestPdf(null, formKey)
    }
    if (row !== undefined) {
      return { bytes: Buffer.from(row.pdf), sha256: row.pdf_sha256, contentType: 'application/pdf' }
    }
    const cat = CATALOG.find((c) => c.formId === formKey)
    if (cat === undefined) throw new FormNotFoundError(formKey)
    return { bytes: readCatalogPdf(formKey), sha256: cat.pdfSha256, contentType: 'application/pdf' }
  }

  // ---- internals ----------------------------------------------------------

  private async resolvePdf(
    chapterId: string,
    input: ConsentFormSaveInput,
    isCatalog: boolean,
  ): Promise<{ pdf: Buffer; sha256: string }> {
    if (input.pdfBase64 !== undefined && input.pdfBase64 !== '') {
      const pdf = Buffer.from(input.pdfBase64, 'base64')
      if (pdf.length === 0) {
        throw new ConsentFormValidationError('pdf_required', 'the uploaded pdf is empty')
      }
      return { pdf, sha256: createHash('sha256').update(pdf).digest('hex') }
    }
    const carried = await this.pdfAtLatest(chapterId, input.formKey)
    if (carried !== undefined) return { pdf: Buffer.from(carried.pdf), sha256: carried.pdf_sha256 }
    if (isCatalog) {
      const pdf = readCatalogPdf(input.formKey)
      return { pdf, sha256: createHash('sha256').update(pdf).digest('hex') }
    }
    throw new ConsentFormValidationError('pdf_required', 'a brand-new consent form requires a pdf upload')
  }

  private async authorizeReadChapter(ctx: AuthContext): Promise<string | null> {
    const chapters = directorChapters(ctx)
    const resource: Resource = chapters.length > 0 ? { chapter_id: chapters[0]! } : {}
    await this.authorize(ctx, 'consent.form.read', resource, { sql: this.sql })
    return chapters.length > 0 ? chapters[0]! : null
  }

  private async resolveManageChapter(
    ctx: AuthContext,
    requested: string | null | undefined,
  ): Promise<string> {
    if (requested != null && requested !== '') {
      await this.authorize(ctx, 'consent.form.manage', { chapter_id: requested }, { sql: this.sql })
      return requested
    }
    const chapters = directorChapters(ctx)
    if (chapters.length > 0) {
      await this.authorize(ctx, 'consent.form.manage', { chapter_id: chapters[0]! }, { sql: this.sql })
      return chapters[0]!
    }
    // No director chapter and no explicit target: authorize a chapterless resource
    // (only a platform override satisfies it), then refuse — a form is always saved
    // against a concrete chapter.
    await this.authorize(ctx, 'consent.form.manage', {}, { sql: this.sql })
    throw new ConsentFormValidationError('malformed', 'a chapter is required to edit a consent form')
  }

  private async publishedLatestByKey(chapterId: string | null): Promise<Map<string, ConsentFormRow>> {
    const rows =
      chapterId === null
        ? await this.sql`
            select distinct on (form_key) ${this.sql.unsafe(ROW_COLS)} from consent_form
            where chapter_id is null and status = 'published'
            order by form_key, version desc
          `
        : await this.sql`
            select distinct on (form_key) ${this.sql.unsafe(ROW_COLS)} from consent_form
            where chapter_id = ${chapterId} and status = 'published'
            order by form_key, version desc
          `
    const m = new Map<string, ConsentFormRow>()
    for (const r of rows) m.set(r.form_key as string, r as unknown as ConsentFormRow)
    return m
  }

  private async publishedLatest(chapterId: string | null, formKey: string): Promise<ConsentFormRow | undefined> {
    const [row] =
      chapterId === null
        ? await this.sql`
            select ${this.sql.unsafe(ROW_COLS)} from consent_form
            where chapter_id is null and form_key = ${formKey} and status = 'published'
            order by version desc limit 1
          `
        : await this.sql`
            select ${this.sql.unsafe(ROW_COLS)} from consent_form
            where chapter_id = ${chapterId} and form_key = ${formKey} and status = 'published'
            order by version desc limit 1
          `
    return row as unknown as ConsentFormRow | undefined
  }

  private async latestAny(chapterId: string, formKey: string): Promise<ConsentFormRow | undefined> {
    const [row] = await this.sql`
      select ${this.sql.unsafe(ROW_COLS)} from consent_form
      where chapter_id = ${chapterId} and form_key = ${formKey}
      order by version desc limit 1
    `
    return row as unknown as ConsentFormRow | undefined
  }

  private async pdfAtVersion(
    chapterId: string | null,
    formKey: string,
    version: number,
  ): Promise<{ pdf: Buffer; pdf_sha256: string } | undefined> {
    const [row] =
      chapterId === null
        ? await this.sql`
            select pdf, pdf_sha256 from consent_form
            where chapter_id is null and form_key = ${formKey} and version = ${version} limit 1
          `
        : await this.sql`
            select pdf, pdf_sha256 from consent_form
            where chapter_id = ${chapterId} and form_key = ${formKey} and version = ${version} limit 1
          `
    return row as unknown as { pdf: Buffer; pdf_sha256: string } | undefined
  }

  private async publishedLatestPdf(
    chapterId: string | null,
    formKey: string,
  ): Promise<{ pdf: Buffer; pdf_sha256: string } | undefined> {
    const [row] =
      chapterId === null
        ? await this.sql`
            select pdf, pdf_sha256 from consent_form
            where chapter_id is null and form_key = ${formKey} and status = 'published'
            order by version desc limit 1
          `
        : await this.sql`
            select pdf, pdf_sha256 from consent_form
            where chapter_id = ${chapterId} and form_key = ${formKey} and status = 'published'
            order by version desc limit 1
          `
    return row as unknown as { pdf: Buffer; pdf_sha256: string } | undefined
  }

  private async pdfAtLatest(
    chapterId: string,
    formKey: string,
  ): Promise<{ pdf: Buffer; pdf_sha256: string } | undefined> {
    const [row] = await this.sql`
      select pdf, pdf_sha256 from consent_form
      where chapter_id = ${chapterId} and form_key = ${formKey}
      order by version desc limit 1
    `
    return row as unknown as { pdf: Buffer; pdf_sha256: string } | undefined
  }
}

// ---- pure mappers ---------------------------------------------------------

function summaryFromRow(row: ConsentFormRow, source: ConsentFormSource): ConsentFormSummary {
  const pdfUrl = pdfUrlFor(row.form_key, row.version)
  return {
    formKey: row.form_key,
    audience: row.audience,
    title: row.title,
    documentId: row.document_id ?? '',
    version: String(row.version),
    elevated: row.elevated,
    itemCount: row.items.length,
    fieldCount: row.fields.length,
    pdfPath: pdfUrl,
    source,
    pdfUrl,
  }
}

function summaryFromCatalog(c: CatalogForm): ConsentFormSummary {
  return {
    formKey: c.formId,
    audience: c.audience,
    title: c.title,
    documentId: c.documentId,
    version: c.version,
    elevated: c.elevated,
    itemCount: c.items.length,
    fieldCount: c.fields.length,
    pdfPath: c.pdfPath,
    source: 'catalog',
    pdfUrl: c.pdfPath,
  }
}

function detailFromRow(row: ConsentFormRow, source: ConsentFormSource): ConsentFormDetail {
  const pdfUrl = pdfUrlFor(row.form_key, row.version)
  return {
    formKey: row.form_key,
    audience: row.audience,
    title: row.title,
    documentId: row.document_id ?? '',
    version: String(row.version),
    elevated: row.elevated,
    pdfPath: pdfUrl,
    source,
    pdfUrl,
    items: row.items,
    fields: markLocked(row.audience, row.fields),
  }
}

function detailFromCatalog(c: CatalogForm): ConsentFormDetail {
  return {
    formKey: c.formId,
    audience: c.audience,
    title: c.title,
    documentId: c.documentId,
    version: c.version,
    elevated: c.elevated,
    pdfPath: c.pdfPath,
    source: 'catalog',
    pdfUrl: c.pdfPath,
    items: c.items,
    fields: markLocked(c.audience, c.fields as EditableField[]),
  }
}

// ---- validation (pure) ----------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Validate a director-authored consent-form definition. Throws
 * ConsentFormValidationError (mapped to 400). Rules (migration 0042 + Phase 2a):
 *   - audience is one of the three;
 *   - a non-empty title;
 *   - every item has non-empty text, boolean required/elevated, and (if a
 *     grantMapping is set) a valid ConsentGrantType;
 *   - every field has a slug-safe fieldType, a non-empty label, an allowed
 *     inputType, and a boolean required;
 *   - all locked default fields for the audience are present (not removed).
 */
export function validateSaveInput(input: ConsentFormSaveInput): void {
  if (!AUDIENCES.includes(input.audience)) {
    throw new ConsentFormValidationError('bad_audience', `unknown audience: ${String(input.audience)}`)
  }
  if (typeof input.title !== 'string' || input.title.trim().length === 0) {
    throw new ConsentFormValidationError('malformed', 'a form title is required')
  }
  if (!Array.isArray(input.items)) {
    throw new ConsentFormValidationError('malformed', 'items must be an array')
  }
  for (const item of input.items) {
    if (!isRecord(item) || typeof item.text !== 'string' || item.text.trim().length === 0) {
      throw new ConsentFormValidationError('empty_item_text', 'each item needs non-empty text', {
        itemKey: isRecord(item) ? item.itemKey : undefined,
      })
    }
    if (typeof item.required !== 'boolean' || typeof item.elevated !== 'boolean') {
      throw new ConsentFormValidationError('bad_item_flag', 'each item needs boolean required/elevated', {
        itemKey: item.itemKey,
      })
    }
    if (item.grantMapping != null && !VALID_GRANT_TYPES.has(item.grantMapping as string)) {
      throw new ConsentFormValidationError('bad_grant_mapping', `unknown grant mapping: ${String(item.grantMapping)}`, {
        itemKey: item.itemKey,
        grantMapping: item.grantMapping,
      })
    }
  }
  if (!Array.isArray(input.fields)) {
    throw new ConsentFormValidationError('malformed', 'fields must be an array')
  }
  for (const field of input.fields) {
    if (!isRecord(field) || typeof field.fieldType !== 'string' || !SLUG_RE.test(field.fieldType)) {
      throw new ConsentFormValidationError('non_slug_field', 'each field needs a slug-safe fieldType', {
        fieldType: isRecord(field) ? field.fieldType : undefined,
      })
    }
    if (typeof field.label !== 'string' || field.label.trim().length === 0) {
      throw new ConsentFormValidationError('bad_field', `field ${field.fieldType} needs a label`, {
        fieldType: field.fieldType,
      })
    }
    if (typeof field.inputType !== 'string' || !FIELD_INPUT_TYPES.includes(field.inputType as EditableFieldInputType)) {
      throw new ConsentFormValidationError('bad_input_type', `field ${field.fieldType} has a bad inputType`, {
        fieldType: field.fieldType,
        inputType: field.inputType,
      })
    }
    if (typeof field.required !== 'boolean') {
      throw new ConsentFormValidationError('bad_field', `field ${field.fieldType} needs a boolean required`, {
        fieldType: field.fieldType,
      })
    }
  }
  const present = new Set(input.fields.map((f) => f.fieldType))
  for (const locked of lockedFieldsFor(input.audience)) {
    if (!present.has(locked.fieldType)) {
      throw new ConsentFormValidationError('locked_field_missing', `locked field removed: ${locked.fieldType}`, {
        fieldType: locked.fieldType,
      })
    }
  }
}

// Re-export the grant type for controller/consumer typing convenience.
export type { ConsentGrantType }
