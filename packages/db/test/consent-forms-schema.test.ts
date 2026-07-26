import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startHarness, type Harness } from './helpers/pg.js'

let h: Harness
beforeAll(async () => { h = await startHarness({ uptoInclusive: process.env.CURIOLAB_MIGRATE_UPTO }) }, 240_000)
afterAll(async () => { await h?.end() })

async function account(dob = '1990-01-01'): Promise<string> {
  const [r] = await h.sql`
    insert into account (email, username, legal_name, display_name, date_of_birth,
      dob_provenance, dob_source_ref, credential_owner, status, maturation_state)
    values (${`a-${randomUUID().slice(0,8)}@ex.test`}, ${null}, 'A', 'A', ${dob},
      'self_reported', ${null}, 'self_private', 'active', 'self_managed') returning id`
  return r!.id as string
}

async function completion(signer: string, subject: string | null) {
  const cid = randomUUID()
  const [sig] = await h.sql`
    insert into consent_signature (completion_id, image, binding)
    values (${cid}, ${Buffer.from('PNG')}, ${h.sql.json({ formId: 'form-01' })}) returning id`
  const [c] = await h.sql`
    insert into consent_form_completion (id, form_id, form_version, pdf_sha256,
      subject_student_account_id, signer_account_id, audience, item_states, field_values, signature_ref)
    values (${cid}, 'form-01', '2026.03', ${'a'.repeat(64)}, ${subject}, ${signer}, 'guardian',
      ${h.sql.json({ 'form-01:item-1': true })}, ${h.sql.json({ guardian_name: 'X' })}, ${sig!.id})
    returning id`
  return c!.id as string
}

describe('consent_form_completion (append-only)', () => {
  test('inserts and rejects UPDATE/DELETE', async () => {
    const g = await account(); const s = await account('2015-01-01')
    const id = await completion(g, s)
    expect(id).toBeTruthy()
    await expect(h.sql`update consent_form_completion set audience = 'x' where id = ${id}`).rejects.toThrow(/append-only/i)
    await expect(h.sql`delete from consent_form_completion where id = ${id}`).rejects.toThrow(/append-only/i)
  })
})

describe('consent_signature (append-only)', () => {
  test('rejects UPDATE/DELETE', async () => {
    const g = await account(); const s = await account('2015-01-01'); await completion(g, s)
    const [row] = await h.sql`select id from consent_signature limit 1`
    await expect(h.sql`update consent_signature set width = 1 where id = ${row!.id}`).rejects.toThrow(/append-only/i)
    await expect(h.sql`delete from consent_signature where id = ${row!.id}`).rejects.toThrow(/append-only/i)
  })
})

describe('guardian_saved_field (mutable, upsert)', () => {
  test('upserts on (guardian, field_type)', async () => {
    const g = await account()
    await h.sql`insert into guardian_saved_field (guardian_account_id, field_type, value_text)
      values (${g}, 'guardian_name', 'First')`
    await h.sql`insert into guardian_saved_field (guardian_account_id, field_type, value_text)
      values (${g}, 'guardian_name', 'Second')
      on conflict (guardian_account_id, field_type) do update set value_text = excluded.value_text, updated_at = now()`
    const [row] = await h.sql`select value_text from guardian_saved_field where guardian_account_id = ${g} and field_type = 'guardian_name'`
    expect(row!.value_text).toBe('Second')
  })
})

describe('consent_form_draft (mutable)', () => {
  test('inserts and updates', async () => {
    const g = await account(); const s = await account('2015-01-01')
    await h.sql`insert into consent_form_draft (guardian_account_id, subject_student_account_id, form_id, item_states)
      values (${g}, ${s}, 'form-02', ${h.sql.json({ a: true })})`
    const upd = await h.sql`update consent_form_draft set item_states = ${h.sql.json({ a: false })}
      where guardian_account_id = ${g} and subject_student_account_id = ${s} and form_id = 'form-02' returning form_id`
    expect(upd.length).toBe(1)
  })
})

describe('Mechanism A roles', () => {
  test('app may SELECT/INSERT completion + signature, not UPDATE/DELETE', async () => {
    const g = await account(); const s = await account('2015-01-01')
    const app = h.connectAs('curiolab_app', 'app_pw')
    const cid = randomUUID()
    const sig = await app`insert into consent_signature (completion_id, image, binding)
      values (${cid}, ${Buffer.from('P')}, ${app.json({})}) returning id`
    await app`insert into consent_form_completion (id, form_id, form_version, pdf_sha256, subject_student_account_id,
      signer_account_id, audience, item_states, field_values, signature_ref)
      values (${cid}, 'form-01', '2026.03', ${'a'.repeat(64)}, ${s}, ${g}, 'guardian', ${app.json({})}, ${app.json({})}, ${sig[0]!.id})`
    await expect(app`update consent_form_completion set audience = 'x' where id = ${cid}`).rejects.toThrow(/permission denied|append-only/i)
  })

  test('analytics denied SELECT on completion (minor-adjacent)', async () => {
    const analytics = h.connectAs('curiolab_analytics', 'analytics_pw')
    await expect(analytics`select 1 from consent_form_completion limit 1`).rejects.toThrow(/permission denied/i)
  })
})
