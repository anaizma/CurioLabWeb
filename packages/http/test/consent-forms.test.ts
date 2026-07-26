import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { startHarness, type Harness } from './helpers/pg.js'
import { onboardStudent, seedVerifiedGuardian } from './helpers/seed.js'
import { listChildForms, submitFormCompletion } from '../src/index.js'
import { getCatalogForm } from '@curiolab/app'

let h: Harness
beforeAll(async () => { h = await startHarness() }, 240_000)
afterAll(async () => { await h?.end() })

describe('listChildForms', () => {
  test('a verified guardian lists 11 forms (200)', async () => {
    const s = await onboardStudent(h.sql, { activate: true })
    const { guardianToken } = await seedVerifiedGuardian(h.sql, s)
    const res = await listChildForms({ sql: h.sql, sessionToken: guardianToken, params: { id: s.accountId } })
    expect(res.status).toBe(200)
    expect((res.body as { items: unknown[] }).items).toHaveLength(11)
  })
  test('no session is an opaque 403', async () => {
    const s = await onboardStudent(h.sql, { activate: true })
    const res = await listChildForms({ sql: h.sql, params: { id: s.accountId } })
    expect(res.status).toBe(403)
  })
})

describe('submitFormCompletion', () => {
  test('captures the grant and returns 201', async () => {
    const s = await onboardStudent(h.sql, { activate: true })
    const { guardianToken } = await seedVerifiedGuardian(h.sql, s)
    const form = getCatalogForm('form-05')!
    const res = await submitFormCompletion({
      sql: h.sql, sessionToken: guardianToken, params: { id: s.accountId, formId: 'form-05' },
      body: { itemStates: Object.fromEntries(form.items.map((i) => [i.itemKey, true])),
        fieldValues: { guardian_name: 'Ada', relationship: 'Parent', date: '2026-07-25' },
        signature: 'data:image/png;base64,aGk=', pdfSha256: form.pdfSha256 },
    })
    expect(res.status).toBe(201)
    expect((res.body as { completionId: string }).completionId).toBeTruthy()
  })
})
