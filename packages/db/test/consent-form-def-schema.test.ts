import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startHarness, type Harness } from './helpers/pg.js'

let h: Harness
beforeAll(async () => { h = await startHarness({ uptoInclusive: process.env.CURIOLAB_MIGRATE_UPTO }) }, 240_000)
afterAll(async () => { await h?.end() })

async function account(): Promise<string> {
  const [r] = await h.sql`
    insert into account (email, username, legal_name, display_name, date_of_birth,
      dob_provenance, dob_source_ref, credential_owner, status, maturation_state)
    values (${`a-${randomUUID().slice(0,8)}@ex.test`}, ${null}, 'A', 'A', '1990-01-01',
      'self_reported', ${null}, 'self_private', 'active', 'self_managed') returning id`
  return r!.id as string
}
async function chapter(): Promise<string> {
  const [r] = await h.sql`insert into chapter (name, slug, tier, status, timezone)
    values ('Ch', ${'ch-'+randomUUID().slice(0,8)}, 'active', 'active', 'America/New_York') returning id`
  return r!.id as string
}

describe('consent_form definition table', () => {
  test('inserts a platform-default published version (chapter_id null)', async () => {
    const by = await account()
    const [row] = await h.sql`
      insert into consent_form (form_key, chapter_id, version, status, audience, document_id, title,
        elevated, pdf, pdf_sha256, items, fields, created_by, published_at)
      values ('form-02', ${null}, 1, 'published', 'guardian', 'CL-CONSENT-02', 'Publish',
        false, ${Buffer.from('%PDF-1.4')}, ${'a'.repeat(64)},
        ${h.sql.json([{ itemKey: 'form-02:item-1', text: 'x', required: false, elevated: false, grantMapping: 'public_publication' }])},
        ${h.sql.json([{ fieldType: 'guardian_name', label: 'Name', inputType: 'text', required: true, fixed: true }])},
        ${by}, now()) returning id, seq`
    expect(row!.id).toBeTruthy(); expect(row!.seq).toBeTruthy()
  })

  test('status is checked; a published row requires published_at', async () => {
    await expect(h.sql`insert into consent_form (form_key, version, status, audience, title, pdf, pdf_sha256, items, fields)
      values ('form-x', 1, 'bogus', 'guardian', 'T', ${Buffer.from('p')}, ${'a'.repeat(64)}, '[]'::jsonb, '[]'::jsonb)`).rejects.toThrow(/check|invalid/i)
    await expect(h.sql`insert into consent_form (form_key, version, status, audience, title, pdf, pdf_sha256, items, fields)
      values ('form-x', 1, 'published', 'guardian', 'T', ${Buffer.from('p')}, ${'a'.repeat(64)}, '[]'::jsonb, '[]'::jsonb)`).rejects.toThrow(/check|published_at|violates/i)
  })

  test('audience is checked', async () => {
    await expect(h.sql`insert into consent_form (form_key, version, status, audience, title, pdf, pdf_sha256, items, fields, published_at)
      values ('form-x', 1, 'draft', 'aliens', 'T', ${Buffer.from('p')}, ${'a'.repeat(64)}, '[]'::jsonb, '[]'::jsonb, null)`).rejects.toThrow(/check|invalid/i)
  })

  test('unique (chapter_id, form_key, version)', async () => {
    const ch = await chapter()
    const ins = () => h.sql`insert into consent_form (form_key, chapter_id, version, status, audience, title, pdf, pdf_sha256, items, fields)
      values ('form-05', ${ch}, 1, 'draft', 'guardian', 'T', ${Buffer.from('p')}, ${'a'.repeat(64)}, '[]'::jsonb, '[]'::jsonb)`
    await ins()
    await expect(ins()).rejects.toThrow(/duplicate|unique/i)
  })

  test('append-only: UPDATE and DELETE are rejected', async () => {
    const [row] = await h.sql`insert into consent_form (form_key, version, status, audience, title, pdf, pdf_sha256, items, fields)
      values ('form-01', 1, 'draft', 'guardian', 'T', ${Buffer.from('p')}, ${'a'.repeat(64)}, '[]'::jsonb, '[]'::jsonb) returning id`
    await expect(h.sql`update consent_form set title = 'y' where id = ${row!.id}`).rejects.toThrow(/append-only/i)
    await expect(h.sql`delete from consent_form where id = ${row!.id}`).rejects.toThrow(/append-only/i)
  })

  test('Mechanism A: app may SELECT/INSERT, not UPDATE/DELETE; analytics denied SELECT', async () => {
    const app = h.connectAs('curiolab_app', 'app_pw')
    const rows = await app`insert into consent_form (form_key, version, status, audience, title, pdf, pdf_sha256, items, fields)
      values ('form-03', 1, 'draft', 'guardian', 'T', ${Buffer.from('p')}, ${'a'.repeat(64)}, '[]'::jsonb, '[]'::jsonb) returning id`
    expect(rows.length).toBe(1)
    await expect(app`update consent_form set title='z' where id=${rows[0]!.id}`).rejects.toThrow(/permission denied|append-only/i)
    const analytics = h.connectAs('curiolab_analytics', 'analytics_pw')
    await expect(analytics`select 1 from consent_form limit 1`).rejects.toThrow(/permission denied/i)
  })
})
