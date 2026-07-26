// -------------------------------------------------------------------------
// The guardian read/submit/pdf path reflects a director-published override
// (consent-form-admin.ts's DB-published-override-catalog), closing Phase 2:
// a chapter override wins over a platform override, which wins over the
// static catalog — the same order ConsentFormAdminService already reads.
// -------------------------------------------------------------------------

import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { AuthContext } from '@curiolab/core'
import { startHarness, type Harness } from './helpers/pg.js'
import { baseCtx, mem } from './helpers/ctx.js'
import { makeAdult, makeChapter, makeMembership, makeMinor } from './helpers/fixtures.js'
import { authorize, withRequest } from '@curiolab/runtime'
import { ConsentFormService } from '../src/consent-form-service.js'
import {
  ConsentFormAdminService,
  type ConsentFormAdminAuthorizeFn,
  type ConsentFormSaveInput,
  type EditableForm,
} from '../src/consent-form-admin.js'
import { getCatalogForm } from '../src/consent-forms/catalog.js'

let h: Harness
beforeAll(async () => { h = await startHarness() }, 240_000)
afterAll(async () => { await h?.end() })

function adminSvc() {
  return new ConsentFormAdminService({ sql: h.sql, authorize: authorize as unknown as ConsentFormAdminAuthorizeFn })
}
function directorCtx(director: string, chapter: string) {
  return baseCtx(director, new Date(), [mem('chapter_director', chapter)])
}
function saveInputFrom(
  formKey: string,
  editable: EditableForm,
  overrides: Partial<ConsentFormSaveInput> = {},
): ConsentFormSaveInput {
  return {
    formKey, audience: editable.audience, title: editable.title, documentId: editable.documentId,
    elevated: editable.elevated, items: editable.items, fields: editable.fields, publish: false, ...overrides,
  }
}

async function seedGuardianChildInChapter(
  chapterId: string, dob = '2015-06-01',
): Promise<{ guardian: string; child: string; ctx: AuthContext }> {
  const guardian = await makeAdult(h.sql)
  const child = await makeMinor(h.sql, { dateOfBirth: dob })
  await makeMembership(h.sql, child, chapterId, { role: 'student' })
  const ctx: AuthContext = { ...baseCtx(guardian, new Date()), guardianOf: [child] }
  return { guardian, child, ctx }
}

describe('ConsentFormService.listForms reflects the published override', () => {
  test('shows the chapter override title; an untouched form still shows the catalog', async () => {
    const chapter = await makeChapter(h.sql)
    const dCtx = directorCtx(await makeAdult(h.sql), chapter)
    const editable = await withRequest(() => adminSvc().getEditable('form-01', dCtx))
    await withRequest(() =>
      adminSvc().saveForm(dCtx, saveInputFrom('form-01', editable, { title: 'Chapter-tuned enrollment', publish: true })),
    )

    const { child, ctx } = await seedGuardianChildInChapter(chapter)
    const svc = new ConsentFormService({ sql: h.sql, authorize })
    const forms = await withRequest(() => svc.listForms(child, ctx))
    expect(forms.find((f) => f.schema.formId === 'form-01')!.schema.title).toBe('Chapter-tuned enrollment')
    expect(forms.find((f) => f.schema.formId === 'form-02')!.schema.title).toBe(getCatalogForm('form-02')!.title)
  })

  test('a guardian whose child is in a DIFFERENT chapter still sees the catalog', async () => {
    const chapter = await makeChapter(h.sql)
    const dCtx = directorCtx(await makeAdult(h.sql), chapter)
    const editable = await withRequest(() => adminSvc().getEditable('form-01', dCtx))
    await withRequest(() =>
      adminSvc().saveForm(dCtx, saveInputFrom('form-01', editable, { title: 'Chapter-tuned enrollment', publish: true })),
    )

    const { child, ctx } = await seedGuardianChildInChapter(await makeChapter(h.sql))
    const svc = new ConsentFormService({ sql: h.sql, authorize })
    const forms = await withRequest(() => svc.listForms(child, ctx))
    expect(forms.find((f) => f.schema.formId === 'form-01')!.schema.title).toBe(getCatalogForm('form-01')!.title)
  })

  test('a PLATFORM (chapter_id null) published override applies when the child chapter has none of its own', async () => {
    await h.sql`
      insert into consent_form (form_key, chapter_id, version, status, audience, title, elevated, pdf, pdf_sha256, items, fields, published_at)
      values ('form-03', null, 1, 'published', 'guardian', 'Platform-wide release wording', false,
        ${Buffer.from('%PDF-1.4 platform')}, ${'deadbeef'.repeat(8)},
        ${h.sql.json(getCatalogForm('form-03')!.items as never)}, ${h.sql.json([])}, now())`

    const { child, ctx } = await seedGuardianChildInChapter(await makeChapter(h.sql))
    const svc = new ConsentFormService({ sql: h.sql, authorize })
    const forms = await withRequest(() => svc.listForms(child, ctx))
    expect(forms.find((f) => f.schema.formId === 'form-03')!.schema.title).toBe('Platform-wide release wording')
  })
})

describe('ConsentFormService.listForms and a director-authored form', () => {
  test('a brand-new guardian form the director published appears for the guardian', async () => {
    const chapter = await makeChapter(h.sql)
    const dCtx = directorCtx(await makeAdult(h.sql), chapter)
    const template = await withRequest(() => adminSvc().getEditable('form-01', dCtx))
    await withRequest(() =>
      adminSvc().saveForm(dCtx, {
        formKey: 'form-90-local-field-trip', audience: 'guardian', title: 'Local Field Trip Permission',
        documentId: 'CL-CONSENT-90', elevated: false,
        items: [{ itemKey: 'form-90:item-1', text: 'I permit my child to attend.', required: true, elevated: false }],
        fields: template.fields, pdfBase64: Buffer.from('%PDF-1.4 field-trip').toString('base64'), publish: true,
      }),
    )

    const { child, ctx } = await seedGuardianChildInChapter(chapter)
    const svc = new ConsentFormService({ sql: h.sql, authorize })
    const forms = await withRequest(() => svc.listForms(child, ctx))
    expect(forms.find((f) => f.schema.formId === 'form-90-local-field-trip')!.schema.title)
      .toBe('Local Field Trip Permission')
  })

  test('the locked signature field is not delivered as a fillable detail field', async () => {
    const chapter = await makeChapter(h.sql)
    const dCtx = directorCtx(await makeAdult(h.sql), chapter)
    const editable = await withRequest(() => adminSvc().getEditable('form-01', dCtx))
    expect(editable.fields.some((f) => f.fieldType === 'signature')).toBe(true)
    await withRequest(() => adminSvc().saveForm(dCtx, saveInputFrom('form-01', editable, { publish: true })))

    const { child, ctx } = await seedGuardianChildInChapter(chapter)
    const svc = new ConsentFormService({ sql: h.sql, authorize })
    const forms = await withRequest(() => svc.listForms(child, ctx))
    // The guardian UI renders the signature through its SignaturePad, never as an
    // AutofillField; a 'signature' detail field would also be permanently unfillable.
    expect(forms.find((f) => f.schema.formId === 'form-01')!.schema.fields.some((f) => f.fieldType === 'signature'))
      .toBe(false)
  })
})

describe('ConsentFormService.submitCompletion validates against the published override', () => {
  test('the stale catalog pdf hash is rejected once the chapter has its own published pdf; the override hash succeeds', async () => {
    const chapter = await makeChapter(h.sql)
    const dCtx = directorCtx(await makeAdult(h.sql), chapter)
    const editable = await withRequest(() => adminSvc().getEditable('form-05', dCtx))
    const uploaded = Buffer.from('%PDF-1.4 chapter-05-override')
    await withRequest(() =>
      adminSvc().saveForm(dCtx, saveInputFrom('form-05', editable, { pdfBase64: uploaded.toString('base64'), publish: true })),
    )

    const { child, ctx } = await seedGuardianChildInChapter(chapter, '2015-01-01')
    const svc = new ConsentFormService({ sql: h.sql, authorize })
    const catalogForm = getCatalogForm('form-05')!
    const base = {
      itemStates: Object.fromEntries(catalogForm.items.map((i) => [i.itemKey, true])),
      fieldValues: { guardian_name: 'Ada', relationship: 'Parent', date: '2026-07-25' },
      signature: 'data:image/png;base64,aGk=',
    }

    await expect(withRequest(() => svc.submitCompletion(child, 'form-05', ctx, { ...base, pdfSha256: catalogForm.pdfSha256 })))
      .rejects.toThrow(/hash mismatch/i)

    const overrideSha256 = createHash('sha256').update(uploaded).digest('hex')
    const res = await withRequest(() => svc.submitCompletion(child, 'form-05', ctx, { ...base, pdfSha256: overrideSha256 }))
    expect(res.completionId).toBeTruthy()
  })
})

describe('ConsentFormService.getFormPdf', () => {
  test('returns the catalog bytes/hash when there is no published override', async () => {
    const { child, ctx } = await seedGuardianChildInChapter(await makeChapter(h.sql))
    const svc = new ConsentFormService({ sql: h.sql, authorize })
    const pdf = await withRequest(() => svc.getFormPdf(child, 'form-01', ctx))
    expect(pdf.sha256).toBe(getCatalogForm('form-01')!.pdfSha256)
    expect(pdf.bytes.length).toBeGreaterThan(0)
  })

  test('returns the chapter override bytes once published', async () => {
    const chapter = await makeChapter(h.sql)
    const dCtx = directorCtx(await makeAdult(h.sql), chapter)
    const editable = await withRequest(() => adminSvc().getEditable('form-01', dCtx))
    const uploaded = Buffer.from('%PDF-1.4 chapter-01-override')
    await withRequest(() =>
      adminSvc().saveForm(dCtx, saveInputFrom('form-01', editable, { pdfBase64: uploaded.toString('base64'), publish: true })),
    )

    const { child, ctx } = await seedGuardianChildInChapter(chapter)
    const svc = new ConsentFormService({ sql: h.sql, authorize })
    const pdf = await withRequest(() => svc.getFormPdf(child, 'form-01', ctx))
    expect(Buffer.from(pdf.bytes).equals(uploaded)).toBe(true)
  })

  test('a caller with no guardian authority over the child is denied', async () => {
    const { child } = await seedGuardianChildInChapter(await makeChapter(h.sql))
    const strangerCtx: AuthContext = { ...baseCtx(await makeAdult(h.sql), new Date()), guardianOf: [] }
    const svc = new ConsentFormService({ sql: h.sql, authorize })
    await expect(withRequest(() => svc.getFormPdf(child, 'form-01', strangerCtx))).rejects.toThrow()
  })
})
