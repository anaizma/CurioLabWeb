// -------------------------------------------------------------------------
// The consent-form definition RESOLVER, shared by the director-facing admin
// service and the guardian-facing completion service so both read one order:
//
//   the chapter's latest PUBLISHED consent_form row (migration 0042)
//     -> else the latest published PLATFORM default (chapter_id NULL)
//       -> else the static committed CATALOG.
//
// An empty consent_form table therefore reads the catalog unchanged, and a
// director's published edit reaches the guardian portal without a redeploy.
// -------------------------------------------------------------------------

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Sql } from 'postgres'
import { CATALOG } from './catalog.js'
import type { CatalogForm, CatalogItem, FormAudience, FormFieldSchema } from './types.js'
import { FormNotFoundError } from '../errors.js'

export type ConsentFormSource = 'catalog' | 'platform' | 'chapter'

/** A consent form as a reader sees it: the catalog form, or a published override. */
export interface ResolvedConsentForm extends CatalogForm {
  source: ConsentFormSource
  /** The consent_form.version behind an override; 0 for the static catalog. */
  definitionVersion: number
}

/** A stored definition field, which (unlike the client shape) may be a signature. */
interface StoredField {
  fieldType: string
  label: string
  inputType: string
  required: boolean
  fixed?: boolean
}

interface DefinitionRow {
  form_key: string
  version: number
  audience: FormAudience
  document_id: string | null
  title: string
  elevated: boolean
  pdf_sha256: string
  items: CatalogItem[]
  fields: StoredField[]
}

/**
 * Drop the signature from the fillable detail fields. The guardian UI collects
 * the signature through its signature pad, not an autofill text input, and
 * submitCompletion requires every `required` field to carry a text value — so a
 * `signature` detail field would be both unrenderable and unsatisfiable.
 */
function toClientFields(fields: StoredField[]): FormFieldSchema[] {
  return fields
    .filter((f) => f.inputType !== 'signature')
    .map((f) => ({
      fieldType: f.fieldType,
      label: f.label,
      inputType: f.inputType as FormFieldSchema['inputType'],
      required: f.required,
    }))
}

function fromRow(row: DefinitionRow, source: ConsentFormSource): ResolvedConsentForm {
  return {
    formId: row.form_key,
    documentId: row.document_id ?? '',
    version: String(row.version),
    title: row.title,
    audience: row.audience,
    elevated: row.elevated,
    // The caller substitutes its own audience-appropriate PDF route: the stored
    // bytes are not a public file, so there is no static path for an override.
    pdfPath: '',
    pdfSha256: row.pdf_sha256,
    items: row.items,
    fields: toClientFields(row.fields),
    source,
    definitionVersion: row.version,
  }
}

function fromCatalog(form: CatalogForm): ResolvedConsentForm {
  return { ...form, source: 'catalog', definitionVersion: 0 }
}

async function publishedByKey(sql: Sql, chapterId: string | null): Promise<Map<string, DefinitionRow>> {
  const rows =
    chapterId === null
      ? await sql`
          select distinct on (form_key)
            form_key, version, audience, document_id, title, elevated, pdf_sha256, items, fields
          from consent_form where chapter_id is null and status = 'published'
          order by form_key, version desc`
      : await sql`
          select distinct on (form_key)
            form_key, version, audience, document_id, title, elevated, pdf_sha256, items, fields
          from consent_form where chapter_id = ${chapterId} and status = 'published'
          order by form_key, version desc`
  const byKey = new Map<string, DefinitionRow>()
  for (const row of rows) byKey.set(row.form_key as string, row as unknown as DefinitionRow)
  return byKey
}

/** Every consent form for a chapter, override-resolved and sorted by form key. */
export async function resolveConsentForms(sql: Sql, chapterId: string | null): Promise<ResolvedConsentForm[]> {
  const [chapterRows, platformRows] = await Promise.all([
    chapterId === null ? Promise.resolve(new Map<string, DefinitionRow>()) : publishedByKey(sql, chapterId),
    publishedByKey(sql, null),
  ])
  const keys = [...new Set([...CATALOG.map((c) => c.formId), ...chapterRows.keys(), ...platformRows.keys()])].sort()
  const out: ResolvedConsentForm[] = []
  for (const key of keys) {
    const chapterRow = chapterRows.get(key)
    const platformRow = platformRows.get(key)
    const catalogForm = CATALOG.find((c) => c.formId === key)
    if (chapterRow !== undefined) out.push(fromRow(chapterRow, 'chapter'))
    else if (platformRow !== undefined) out.push(fromRow(platformRow, 'platform'))
    else if (catalogForm !== undefined) out.push(fromCatalog(catalogForm))
  }
  return out
}

/** One consent form for a chapter, override-resolved; undefined when unknown. */
export async function resolveConsentForm(
  sql: Sql,
  chapterId: string | null,
  formId: string,
): Promise<ResolvedConsentForm | undefined> {
  if (chapterId !== null) {
    const [row] = await sql`
      select form_key, version, audience, document_id, title, elevated, pdf_sha256, items, fields
      from consent_form where chapter_id = ${chapterId} and form_key = ${formId} and status = 'published'
      order by version desc limit 1`
    if (row !== undefined) return fromRow(row as unknown as DefinitionRow, 'chapter')
  }
  const [platformRow] = await sql`
    select form_key, version, audience, document_id, title, elevated, pdf_sha256, items, fields
    from consent_form where chapter_id is null and form_key = ${formId} and status = 'published'
    order by version desc limit 1`
  if (platformRow !== undefined) return fromRow(platformRow as unknown as DefinitionRow, 'platform')
  const catalogForm = CATALOG.find((c) => c.formId === formId)
  return catalogForm === undefined ? undefined : fromCatalog(catalogForm)
}

/** The PDF bytes behind a resolved form: the published override, else the catalog file. */
export async function resolveConsentFormPdf(
  sql: Sql,
  chapterId: string | null,
  formId: string,
): Promise<{ bytes: Buffer; sha256: string }> {
  if (chapterId !== null) {
    const [row] = await sql`
      select pdf, pdf_sha256 from consent_form
      where chapter_id = ${chapterId} and form_key = ${formId} and status = 'published'
      order by version desc limit 1`
    if (row !== undefined) return { bytes: Buffer.from(row.pdf as Buffer), sha256: row.pdf_sha256 as string }
  }
  const [platformRow] = await sql`
    select pdf, pdf_sha256 from consent_form
    where chapter_id is null and form_key = ${formId} and status = 'published'
    order by version desc limit 1`
  if (platformRow !== undefined) {
    return { bytes: Buffer.from(platformRow.pdf as Buffer), sha256: platformRow.pdf_sha256 as string }
  }
  const catalogForm = CATALOG.find((c) => c.formId === formId)
  if (catalogForm === undefined) throw new FormNotFoundError(formId)
  return { bytes: readCatalogPdf(formId), sha256: catalogForm.pdfSha256 }
}

/** Read a committed catalog PDF (public/consent-forms/<formKey>.pdf) from the repo. */
export function readCatalogPdf(formKey: string): Buffer {
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
