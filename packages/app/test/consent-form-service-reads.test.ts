import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { AuthContext } from '@curiolab/core'
import { startHarness, type Harness } from './helpers/pg.js'
import { baseCtx } from './helpers/ctx.js'
import { makeAdult, makeMinor } from './helpers/fixtures.js'
import { ConsentFormService } from '../src/consent-form-service.js'
import { authorize, withRequest } from '@curiolab/runtime'

let h: Harness
beforeAll(async () => { h = await startHarness() }, 240_000)
afterAll(async () => { await h?.end() })

async function seedGuardianChild(dob = '2015-06-01'): Promise<{ guardian: string; child: string; ctx: AuthContext }> {
  const guardian = await makeAdult(h.sql)
  const child = await makeMinor(h.sql, { dateOfBirth: dob })
  const ctx: AuthContext = { ...baseCtx(guardian, new Date()), guardianOf: [child] }
  return { guardian, child, ctx }
}

describe('ConsentFormService.listForms', () => {
  test('returns all 11 forms; guardian forms status not_started initially', async () => {
    const { child, ctx } = await seedGuardianChild()
    const svc = new ConsentFormService({ sql: h.sql, authorize })
    const forms = await withRequest(() => svc.listForms(child, ctx))
    expect(forms).toHaveLength(11)
    expect(forms.find((f) => f.schema.formId === 'form-02')!.status).toBe('not_started')
  })
})

describe('ConsentFormService saved fields + draft', () => {
  test('saveDraft then getDraft round-trips; getSavedFields reads upserted values', async () => {
    const { child, ctx } = await seedGuardianChild()
    const svc = new ConsentFormService({ sql: h.sql, authorize })
    await withRequest(() => svc.saveDraft(child, 'form-02', ctx, {
      itemStates: { 'form-02:item-1': true }, fieldValues: { guardian_name: 'Ada' },
      signature: '', pdfSha256: '',
    }))
    const d = await svc.getDraft(child, 'form-02', ctx)
    expect(d!.fieldValues.guardian_name).toBe('Ada')
    const draftForm = (await withRequest(() => svc.listForms(child, ctx))).find((f) => f.schema.formId === 'form-02')!
    expect(draftForm.status).toBe('in_progress')
  })
})
