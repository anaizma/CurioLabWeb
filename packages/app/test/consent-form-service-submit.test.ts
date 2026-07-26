import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { AuthContext } from '@curiolab/core'
import { startHarness, type Harness } from './helpers/pg.js'
import { baseCtx } from './helpers/ctx.js'
import { makeAdult, makeMinor } from './helpers/fixtures.js'
import { authorize, withRequest } from '@curiolab/runtime'
import { ConsentFormService } from '../src/consent-form-service.js'
import { ConsentGrantService } from '../src/consent-grant.js'
import { getCatalogForm } from '../src/consent-forms/catalog.js'

let h: Harness
beforeAll(async () => { h = await startHarness() }, 240_000)
afterAll(async () => { await h?.end() })

async function seedGuardianChild(dob = '2015-06-01'): Promise<{ guardian: string; child: string; ctx: AuthContext }> {
  const guardian = await makeAdult(h.sql)
  const child = await makeMinor(h.sql, { dateOfBirth: dob })
  const ctx: AuthContext = { ...baseCtx(guardian, new Date()), guardianOf: [child] }
  return { guardian, child, ctx }
}

describe('submitCompletion drives the grant ledger', () => {
  test('a standard form (form-05) captures its grant with method click and evidence = completionId', async () => {
    const { child, ctx } = await seedGuardianChild('2015-01-01')
    const svc = new ConsentFormService({ sql: h.sql, authorize })
    const form = getCatalogForm('form-05')!
    const res = await withRequest(() => svc.submitCompletion(child, 'form-05', ctx, {
      itemStates: Object.fromEntries(form.items.map((i) => [i.itemKey, true])),
      fieldValues: { guardian_name: 'Ada', relationship: 'Parent', date: '2026-07-25' },
      signature: 'data:image/png;base64,aGk=', pdfSha256: form.pdfSha256,
    }))
    expect(res.completionId).toBeTruthy()
    const grants = await withRequest(() => new ConsentGrantService({ sql: h.sql, authorize }).viewChildGrants(child, ctx))
    const vls = grants.find((g) => g.grantType === 'verification_link_sharing')!
    expect(vls.status).toBe('active')
    expect(vls.evidenceArtifactRef).toBe(res.completionId)
    expect(vls.method).toBe('click')
  })

  test('a required item unchecked is rejected', async () => {
    const { child, ctx } = await seedGuardianChild()
    const svc = new ConsentFormService({ sql: h.sql, authorize })
    await expect(withRequest(() => svc.submitCompletion(child, 'form-01', ctx, {
      itemStates: {}, fieldValues: {}, signature: 'data:image/png;base64,aGk=', pdfSha256: getCatalogForm('form-01')!.pdfSha256,
    }))).rejects.toThrow(/required item/i)
  })

  test('an empty or malformed signature is rejected (a completion is a legal artifact)', async () => {
    const { child, ctx } = await seedGuardianChild()
    const svc = new ConsentFormService({ sql: h.sql, authorize })
    const form = getCatalogForm('form-05')!
    const base = {
      itemStates: Object.fromEntries(form.items.map((i) => [i.itemKey, true])),
      fieldValues: { guardian_name: 'A', relationship: 'P', date: '2026-07-25' }, pdfSha256: form.pdfSha256,
    }
    await expect(withRequest(() => svc.submitCompletion(child, 'form-05', ctx, { ...base, signature: '' })))
      .rejects.toThrow(/signature/i)
    await expect(withRequest(() => svc.submitCompletion(child, 'form-05', ctx, { ...base, signature: 'not-a-data-url' })))
      .rejects.toThrow(/signature/i)
  })

  test('pdf hash mismatch is rejected', async () => {
    const { child, ctx } = await seedGuardianChild()
    const svc = new ConsentFormService({ sql: h.sql, authorize })
    const form = getCatalogForm('form-05')!
    await expect(withRequest(() => svc.submitCompletion(child, 'form-05', ctx, {
      itemStates: Object.fromEntries(form.items.map((i) => [i.itemKey, true])),
      fieldValues: { guardian_name: 'A', relationship: 'P', date: '2026-07-25' },
      signature: 'data:image/png;base64,aGk=', pdfSha256: 'deadbeef',
    }))).rejects.toThrow(/hash mismatch/i)
  })

  test('under-13 public_publication (form-02) with a reused signature ONLY is rejected; with verification it captures', async () => {
    const { child, ctx } = await seedGuardianChild('2016-01-01')
    const svc = new ConsentFormService({ sql: h.sql, authorize })
    const form = getCatalogForm('form-02')!
    const checkedFirst = { [form.items[0]!.itemKey]: true, ...Object.fromEntries(form.items.slice(1).map((i) => [i.itemKey, false])) }
    const base = { itemStates: checkedFirst, fieldValues: { guardian_name: 'A', relationship: 'P', date: '2026-07-25' }, signature: 'data:image/png;base64,aGk=', pdfSha256: form.pdfSha256 }
    await expect(withRequest(() => svc.submitCompletion(child, 'form-02', ctx, base))).rejects.toThrow(/elevated verification/i)
    const ok = await withRequest(() => svc.submitCompletion(child, 'form-02', ctx, { ...base, verification: { method: 'signed_form', evidenceArtifactRef: 'artifact://stub' } }))
    expect(ok.completionId).toBeTruthy()
    const grants = await withRequest(() => new ConsentGrantService({ sql: h.sql, authorize }).viewChildGrants(child, ctx))
    expect(grants.find((g) => g.grantType === 'public_publication')!.status).toBe('active')
  })
})
