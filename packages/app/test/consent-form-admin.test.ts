// -------------------------------------------------------------------------
// ConsentFormAdminService — the director-editable consent forms (Phase 2a):
// the DB-published-override-catalog read overlay, the getEditable editor load,
// the versioned saveForm (draft/publish) with the carried/uploaded PDF, the
// locked-default-field guard, the grantMapping validation, and the PDF serve.
// Embedded Postgres, synthetic data only. The consent_form table (migration
// 0042) is append-only and starts EMPTY, so an untouched chapter reads the
// static catalog.
// -------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Forbidden, authorize, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import {
  ConsentFormAdminService,
  ConsentFormValidationError,
  lockedFieldsFor,
  type ConsentFormAdminAuthorizeFn,
  type ConsentFormSaveInput,
} from '../src/index.js'

let h: Harness
beforeAll(async () => { h = await startHarness() }, 240_000)
afterAll(async () => { await h?.end() })

function svc() {
  return new ConsentFormAdminService({ sql: h.sql, authorize: authorize as unknown as ConsentFormAdminAuthorizeFn })
}
function directorCtx(director: string, chapter: string) {
  return baseCtx(director, new Date(), [mem('chapter_director', chapter)])
}

/** Build a save input from the editor-materialized editable definition. */
function saveInputFrom(
  formKey: string,
  editable: Awaited<ReturnType<ConsentFormAdminService['getEditable']>>,
  overrides: Partial<ConsentFormSaveInput> = {},
): ConsentFormSaveInput {
  return {
    formKey,
    audience: editable.audience,
    title: editable.title,
    documentId: editable.documentId,
    elevated: editable.elevated,
    items: editable.items,
    fields: editable.fields,
    publish: false,
    ...overrides,
  }
}

// ===========================================================================
describe('lockedFieldsFor (pure)', () => {
  test('guardian locks 4 fields incl. a signature; mentor/student lock 3', () => {
    const g = lockedFieldsFor('guardian')
    expect(g.map((f) => f.fieldType).sort()).toEqual(['date', 'guardian_name', 'relationship', 'signature'])
    expect(g.every((f) => f.fixed === true && f.required === true)).toBe(true)
    expect(g.find((f) => f.fieldType === 'signature')!.inputType).toBe('signature')
    expect(lockedFieldsFor('mentor').map((f) => f.fieldType).sort()).toEqual(['date', 'mentor_name', 'signature'])
    expect(lockedFieldsFor('student').map((f) => f.fieldType).sort()).toEqual(['date', 'signature', 'student_name'])
  })
})

// ===========================================================================
describe('read overlay: empty DB falls back to the static catalog', () => {
  test('listForms returns the catalog (source catalog) when the chapter has no rows', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const ctx = directorCtx(director, chapter)
    const forms = await withRequest(() => svc().listForms(ctx))
    expect(forms.length).toBeGreaterThanOrEqual(11)
    expect(forms.every((f) => f.source === 'catalog')).toBe(true)
    const f1 = forms.find((f) => f.formKey === 'form-01')!
    expect(f1.pdfUrl).toBe('/consent-forms/form-01.pdf')
  })
})

// ===========================================================================
describe('getEditable + saveForm (draft/publish) + read overlay', () => {
  test('materializes from catalog, saves a draft (v1), a second save bumps to v2', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const ctx = directorCtx(director, chapter)

    const editable = await withRequest(() => svc().getEditable('form-01', ctx))
    expect(editable.version).toBe(0)
    expect(editable.hasDraft).toBe(false)
    // The locked signature field is merged in and marked fixed.
    expect(editable.fields.find((f) => f.fieldType === 'signature')?.fixed).toBe(true)

    const first = await withRequest(() => svc().saveForm(ctx, saveInputFrom('form-01', editable)))
    expect(first).toMatchObject({ formKey: 'form-01', version: 1, status: 'draft' })

    const afterDraft = await withRequest(() => svc().getEditable('form-01', ctx))
    expect(afterDraft.version).toBe(1)
    expect(afterDraft.status).toBe('draft')
    expect(afterDraft.hasDraft).toBe(true)

    const second = await withRequest(() => svc().saveForm(ctx, saveInputFrom('form-01', editable)))
    expect(second.version).toBe(2)
  })

  test('publish makes listForms/getForm return the DB version (source chapter), overriding the catalog', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const ctx = directorCtx(director, chapter)

    const editable = await withRequest(() => svc().getEditable('form-01', ctx))
    const published = await withRequest(() =>
      svc().saveForm(ctx, saveInputFrom('form-01', editable, { title: 'Chapter-tuned enrollment', publish: true })),
    )
    expect(published.status).toBe('published')

    const forms = await withRequest(() => svc().listForms(ctx))
    const f1 = forms.find((f) => f.formKey === 'form-01')!
    expect(f1.source).toBe('chapter')
    expect(f1.title).toBe('Chapter-tuned enrollment')
    expect(f1.pdfUrl).toBe(`/api/ops/consent-forms/form-01/pdf?v=${published.version}`)
    // an untouched form is still the catalog
    expect(forms.find((f) => f.formKey === 'form-02')!.source).toBe('catalog')

    const detail = await withRequest(() => svc().getForm('form-01', ctx))
    expect(detail!.source).toBe('chapter')
    expect(detail!.title).toBe('Chapter-tuned enrollment')

    // a DIFFERENT chapter still sees the catalog (per-chapter override).
    const otherDir = await makeAdult(h.sql)
    const otherChapter = await makeChapter(h.sql)
    const otherCtx = directorCtx(otherDir, otherChapter)
    const otherForms = await withRequest(() => svc().listForms(otherCtx))
    expect(otherForms.find((f) => f.formKey === 'form-01')!.source).toBe('catalog')
  })

  test('a save missing a locked default field is rejected and writes nothing', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const ctx = directorCtx(director, chapter)
    const editable = await withRequest(() => svc().getEditable('form-01', ctx))
    const input = saveInputFrom('form-01', editable, {
      fields: editable.fields.filter((f) => f.fieldType !== 'signature'),
    })
    let caught: unknown
    await withRequest(async () => {
      try { await svc().saveForm(ctx, input) } catch (e) { caught = e }
    })
    expect(caught).toBeInstanceOf(ConsentFormValidationError)
    expect((caught as ConsentFormValidationError).code).toBe('locked_field_missing')
    const rows = await h.sql`select id from consent_form where chapter_id = ${chapter} and form_key = 'form-01'`
    expect(rows).toHaveLength(0)
  })

  test('an item grantMapping with an unknown value is rejected', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const ctx = directorCtx(director, chapter)
    const editable = await withRequest(() => svc().getEditable('form-01', ctx))
    const badItems = editable.items.map((it, i) =>
      i === 0 ? { ...it, grantMapping: 'not_a_real_grant' as never } : it,
    )
    let caught: unknown
    await withRequest(async () => {
      try { await svc().saveForm(ctx, saveInputFrom('form-01', editable, { items: badItems })) } catch (e) { caught = e }
    })
    expect(caught).toBeInstanceOf(ConsentFormValidationError)
    expect((caught as ConsentFormValidationError).code).toBe('bad_grant_mapping')
  })

  test('consent.form.manage is enforced: a non-director save is denied and writes nothing', async () => {
    const chapter = await makeChapter(h.sql)
    const actor = await makeAdult(h.sql)
    const ctx = baseCtx(actor, new Date(), [mem('lead_instructor', chapter)])
    const dir = await makeAdult(h.sql)
    const editable = await withRequest(() => svc().getEditable('form-01', directorCtx(dir, chapter)))
    let caught: unknown
    await withRequest(async () => {
      try { await svc().saveForm(ctx, saveInputFrom('form-01', editable, { publish: true })) } catch (e) { caught = e }
    })
    expect(caught).toBeInstanceOf(Forbidden)
  })
})

// ===========================================================================
describe('getFormPdf', () => {
  test('returns the static catalog bytes when the chapter has no DB row', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const ctx = directorCtx(director, chapter)
    const pdf = await withRequest(() => svc().getFormPdf('form-01', ctx))
    expect(pdf.contentType).toBe('application/pdf')
    expect(pdf.bytes.length).toBeGreaterThan(0)
    expect(pdf.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  test('after a save with an uploaded PDF, getFormPdf returns the stored bytes at that version', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const ctx = directorCtx(director, chapter)
    const editable = await withRequest(() => svc().getEditable('form-01', ctx))
    const uploaded = Buffer.from('%PDF-1.4 chapter-custom pdf bytes')
    const saved = await withRequest(() =>
      svc().saveForm(ctx, saveInputFrom('form-01', editable, { pdfBase64: uploaded.toString('base64'), publish: true })),
    )
    const pdf = await withRequest(() => svc().getFormPdf('form-01', ctx, saved.version))
    expect(Buffer.from(pdf.bytes).equals(uploaded)).toBe(true)
  })
})
