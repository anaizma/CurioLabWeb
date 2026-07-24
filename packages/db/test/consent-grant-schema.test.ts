// -------------------------------------------------------------------------
// admin/director backend §5 — consent_grant append-only grant ledger schema.
//
// The additive migration 0024_consent_grant_ledger.sql adds the six-type,
// append-only consent GRANT ledger (a PEER of consent, never a replacement),
// its current-status projection view, and the notify-and-object publication_hold
// table. These tests are the red-before-green witnesses for the migration's
// guarantees:
//   * consent_grant exists; append-only (UPDATE/DELETE rejected by trigger +
//     REVOKE); the six grant-type + five method enums; subject/guardian fks;
//   * the under-13 public_publication strong-method DB floor (a click, or a
//     missing artifact, for a subject under 13 is REFUSED; a strong method +
//     artifact is accepted; 13+ click is accepted);
//   * consent_grant_current reflects the latest grant per (subject, type), with
//     active = non-revoked AND non-expired;
//   * publication_hold exists (not append-only — object/release UPDATE it);
//   * Mechanism-A grants: app may SELECT/INSERT consent_grant (not UPDATE/DELETE),
//     SELECT/INSERT/UPDATE publication_hold; analytics denied SELECT on both.
//
// TDD: run with CURIOLAB_MIGRATE_UPTO=0023 to witness these fail (the relations
// do not exist yet); the default run applies 0024 and they pass.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startHarness, type Harness } from './helpers/pg.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness({ uptoInclusive: process.env.CURIOLAB_MIGRATE_UPTO })
}, 240_000)

afterAll(async () => {
  await h?.end()
})

async function makeAccount(dob = '1990-01-01'): Promise<string> {
  const [row] = await h.sql`
    insert into account (
      email, username, legal_name, display_name, date_of_birth,
      dob_provenance, dob_source_ref, credential_owner, status, maturation_state
    ) values (
      ${`gr-${randomUUID().slice(0, 8)}@example.test`}, ${null}, 'Adult Testperson', 'Adult T.',
      ${dob}, 'self_reported', ${null}, 'self_private', 'active', 'self_managed'
    ) returning id
  `
  return row!.id as string
}

// A subject and a guardian; the subject's DOB drives the under-13 rule.
async function subjectAndGuardian(subjectDob: string): Promise<{ subject: string; guardian: string }> {
  const guardian = await makeAccount()
  const [row] = await h.sql`
    insert into account (
      email, username, legal_name, display_name, date_of_birth,
      dob_provenance, dob_source_ref, credential_owner, status, maturation_state
    ) values (
      ${null}, ${`st-${randomUUID().slice(0, 8)}`}, 'Minor Testchild', 'Minor T.',
      ${subjectDob}, 'enrollment_record', ${randomUUID()}, 'guardian_provisioned', 'active', 'minor'
    ) returning id
  `
  return { subject: row!.id as string, guardian }
}

// ---------------------------------------------------------------------------
describe('consent_grant shape and enums', () => {
  test('a grant row inserts with type, subject, guardian, method, expiry', async () => {
    const { subject, guardian } = await subjectAndGuardian('2015-06-01')
    const [row] = await h.sql`
      insert into consent_grant (
        grant_type, subject_student_account_id, guardian_account_id, method,
        expires_at
      ) values (
        'platform_account', ${subject}, ${guardian}, 'click', now() + interval '90 days'
      ) returning id, granted_at, revoked_at, seq
    `
    expect(row!.id).toBeTruthy()
    expect(row!.granted_at).not.toBeNull()
    expect(row!.revoked_at).toBeNull()
    expect(row!.seq).toBeTruthy()
  })

  test('grant_type is a checked enum: garbage is rejected', async () => {
    const { subject } = await subjectAndGuardian('2015-06-01')
    await expect(h.sql`
      insert into consent_grant (grant_type, subject_student_account_id, method)
      values ('not_a_type', ${subject}, 'click')
    `).rejects.toThrow(/invalid input value for enum/i)
  })

  test('method is a checked enum: garbage is rejected', async () => {
    const { subject } = await subjectAndGuardian('2015-06-01')
    await expect(h.sql`
      insert into consent_grant (grant_type, subject_student_account_id, method)
      values ('platform_account', ${subject}, 'telepathy')
    `).rejects.toThrow(/invalid input value for enum/i)
  })

  test('subject fk is checked', async () => {
    await expect(h.sql`
      insert into consent_grant (grant_type, subject_student_account_id, method)
      values ('platform_account', ${randomUUID()}, 'click')
    `).rejects.toThrow(/foreign key|violates/i)
  })
})

// ---------------------------------------------------------------------------
describe('under-13 public_publication strong-method DB floor', () => {
  test('a click for a subject under 13 is REFUSED', async () => {
    const { subject, guardian } = await subjectAndGuardian('2016-01-01') // ~10y in 2026
    await expect(h.sql`
      insert into consent_grant (
        grant_type, subject_student_account_id, guardian_account_id, method, evidence_artifact_ref
      ) values ('public_publication', ${subject}, ${guardian}, 'click', 'artifact://x')
    `).rejects.toThrow(/strong.*method|under 13|public_publication/i)
  })

  test('a strong method without an artifact for a subject under 13 is REFUSED', async () => {
    const { subject, guardian } = await subjectAndGuardian('2016-01-01')
    await expect(h.sql`
      insert into consent_grant (
        grant_type, subject_student_account_id, guardian_account_id, method, evidence_artifact_ref
      ) values ('public_publication', ${subject}, ${guardian}, 'signed_form', ${null})
    `).rejects.toThrow(/artifact|evidence|under 13/i)
  })

  test('a strong method WITH an artifact for a subject under 13 is accepted', async () => {
    const { subject, guardian } = await subjectAndGuardian('2016-01-01')
    const [row] = await h.sql`
      insert into consent_grant (
        grant_type, subject_student_account_id, guardian_account_id, method, evidence_artifact_ref
      ) values ('public_publication', ${subject}, ${guardian}, 'signed_form', 'artifact://form.pdf')
      returning id
    `
    expect(row!.id).toBeTruthy()
  })

  test('a click for a subject 13+ is accepted', async () => {
    const { subject, guardian } = await subjectAndGuardian('2008-01-01') // ~18y
    const [row] = await h.sql`
      insert into consent_grant (
        grant_type, subject_student_account_id, guardian_account_id, method
      ) values ('public_publication', ${subject}, ${guardian}, 'click')
      returning id
    `
    expect(row!.id).toBeTruthy()
  })

  test('a REVOCATION row for under-13 public_publication is not blocked by the floor', async () => {
    const { subject, guardian } = await subjectAndGuardian('2016-01-01')
    // A revocation is a new row carrying revoked_at; the strong-method floor
    // applies to GRANTS (revoked_at null), not to the revocation event.
    const [row] = await h.sql`
      insert into consent_grant (
        grant_type, subject_student_account_id, guardian_account_id, method, revoked_at, revoked_by
      ) values ('public_publication', ${subject}, ${guardian}, 'click', now(), ${guardian})
      returning id
    `
    expect(row!.id).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
describe('consent_grant_current projection', () => {
  test('active iff a non-revoked, non-expired grant is the latest', async () => {
    const { subject, guardian } = await subjectAndGuardian('2015-06-01')
    await h.sql`
      insert into consent_grant (grant_type, subject_student_account_id, guardian_account_id, method, expires_at)
      values ('platform_account', ${subject}, ${guardian}, 'click', now() + interval '90 days')
    `
    const [cur] = await h.sql`
      select active, grant_type from consent_grant_current
      where subject_student_account_id = ${subject} and grant_type = 'platform_account'
    `
    expect(cur!.active).toBe(true)
  })

  test('a later revocation row flips current to inactive', async () => {
    const { subject, guardian } = await subjectAndGuardian('2015-06-01')
    await h.sql`
      insert into consent_grant (grant_type, subject_student_account_id, guardian_account_id, method)
      values ('verification_link_sharing', ${subject}, ${guardian}, 'click')
    `
    await h.sql`
      insert into consent_grant (grant_type, subject_student_account_id, guardian_account_id, method, revoked_at, revoked_by)
      values ('verification_link_sharing', ${subject}, ${guardian}, 'click', now(), ${guardian})
    `
    const [cur] = await h.sql`
      select active from consent_grant_current
      where subject_student_account_id = ${subject} and grant_type = 'verification_link_sharing'
    `
    expect(cur!.active).toBe(false)
  })

  test('an expired grant is not active', async () => {
    const { subject, guardian } = await subjectAndGuardian('2015-06-01')
    await h.sql`
      insert into consent_grant (grant_type, subject_student_account_id, guardian_account_id, method, granted_at, expires_at)
      values ('platform_account', ${subject}, ${guardian}, 'click', now() - interval '400 days', now() - interval '10 days')
    `
    const [cur] = await h.sql`
      select active from consent_grant_current
      where subject_student_account_id = ${subject} and grant_type = 'platform_account'
    `
    expect(cur!.active).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('append-only enforcement on consent_grant', () => {
  test('UPDATE is rejected by the trigger (even as owner)', async () => {
    const { subject, guardian } = await subjectAndGuardian('2015-06-01')
    const [row] = await h.sql`
      insert into consent_grant (grant_type, subject_student_account_id, guardian_account_id, method)
      values ('platform_account', ${subject}, ${guardian}, 'click') returning id
    `
    await expect(
      h.sql`update consent_grant set revoked_at = now() where id = ${row!.id}`,
    ).rejects.toThrow(/append-only/i)
  })

  test('DELETE is rejected by the trigger (even as owner)', async () => {
    const { subject, guardian } = await subjectAndGuardian('2015-06-01')
    const [row] = await h.sql`
      insert into consent_grant (grant_type, subject_student_account_id, guardian_account_id, method)
      values ('platform_account', ${subject}, ${guardian}, 'click') returning id
    `
    await expect(h.sql`delete from consent_grant where id = ${row!.id}`).rejects.toThrow(/append-only/i)
  })
})

// ---------------------------------------------------------------------------
describe('publication_hold shape (not append-only)', () => {
  test('a hold inserts and can be UPDATEd to object/release', async () => {
    const { subject, guardian } = await subjectAndGuardian('2015-06-01')
    const [row] = await h.sql`
      insert into publication_hold (
        item_type, item_ref, subject_student_account_id, guardian_account_id, releases_at
      ) values ('project', ${randomUUID()}, ${subject}, ${guardian}, now() + interval '5 days')
      returning id, objected_at, released_at
    `
    expect(row!.id).toBeTruthy()
    expect(row!.objected_at).toBeNull()
    expect(row!.released_at).toBeNull()
    const upd = await h.sql`
      update publication_hold set objected_at = now(), objected_by = ${guardian} where id = ${row!.id} returning id
    `
    expect(upd.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
describe('Mechanism A: grants on the new tables', () => {
  test('app may SELECT/INSERT consent_grant but not UPDATE/DELETE', async () => {
    const { subject, guardian } = await subjectAndGuardian('2015-06-01')
    const app = h.connectAs('curiolab_app', 'app_pw')
    const rows = await app`
      insert into consent_grant (grant_type, subject_student_account_id, guardian_account_id, method)
      values ('platform_account', ${subject}, ${guardian}, 'click') returning id
    `
    expect(rows.length).toBe(1)
    const read = await app`select id from consent_grant where id = ${rows[0]!.id}`
    expect(read.length).toBe(1)
    await expect(
      app`update consent_grant set method = 'signed_form' where id = ${rows[0]!.id}`,
    ).rejects.toThrow(/permission denied|append-only/i)
    await expect(app`delete from consent_grant where id = ${rows[0]!.id}`).rejects.toThrow(
      /permission denied|append-only/i,
    )
  })

  test('analytics is denied SELECT on consent_grant (default-deny — minor-adjacent)', async () => {
    const { subject, guardian } = await subjectAndGuardian('2015-06-01')
    await h.sql`
      insert into consent_grant (grant_type, subject_student_account_id, guardian_account_id, method)
      values ('platform_account', ${subject}, ${guardian}, 'click')
    `
    const analytics = h.connectAs('curiolab_analytics', 'analytics_pw')
    await expect(analytics`select 1 from consent_grant limit 1`).rejects.toThrow(/permission denied/i)
  })

  test('app may SELECT/INSERT/UPDATE publication_hold; analytics denied SELECT', async () => {
    const { subject } = await subjectAndGuardian('2015-06-01')
    const app = h.connectAs('curiolab_app', 'app_pw')
    const rows = await app`
      insert into publication_hold (item_type, item_ref, subject_student_account_id, releases_at)
      values ('narrative', ${randomUUID()}, ${subject}, now() + interval '5 days') returning id
    `
    expect(rows.length).toBe(1)
    const upd = await app`update publication_hold set released_at = now() where id = ${rows[0]!.id} returning id`
    expect(upd.length).toBe(1)
    const analytics = h.connectAs('curiolab_analytics', 'analytics_pw')
    await expect(analytics`select 1 from publication_hold limit 1`).rejects.toThrow(/permission denied/i)
  })
})
