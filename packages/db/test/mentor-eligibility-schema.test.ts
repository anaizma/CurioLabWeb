// -------------------------------------------------------------------------
// admin/director backend §6 — mentor_eligibility append-only clearance ledger.
//
// The additive migration 0025_mentor_eligibility.sql records mentor eligibility
// as STATE: an append-only row per (membership, component) clearance, with a
// current-status projection view. Mirrors the consent_grant pattern (0024) — a
// renewal is a NEW row, a lapse is expiry, never a mutation. These tests are the
// red-before-green witnesses:
//   * mentor_eligibility exists; the four-component enum; membership/account fks;
//   * append-only (UPDATE/DELETE rejected by the trigger + role REVOKE);
//   * mentor_eligibility_current reflects the latest row per (membership,
//     component) with active = non-expired as of now();
//   * Mechanism-A grants: app may SELECT/INSERT (not UPDATE/DELETE); analytics
//     denied SELECT (mentor-adjacent, default-deny).
//
// TDD: run with CURIOLAB_MIGRATE_UPTO=0024 to witness these fail (the relations do
// not exist yet); the default run applies 0025 and they pass.
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

async function makeAccount(): Promise<string> {
  const [row] = await h.sql`
    insert into account (
      email, username, legal_name, display_name, date_of_birth,
      dob_provenance, dob_source_ref, credential_owner, status, maturation_state
    ) values (
      ${`mentor-${randomUUID().slice(0, 8)}@example.test`}, ${null}, 'Adult Testperson', 'Adult T.',
      '1990-01-01', 'staff_entered', ${null}, 'self_private', 'active', 'self_managed'
    ) returning id
  `
  return row!.id as string
}

async function makeChapter(): Promise<string> {
  const [row] = await h.sql`
    insert into chapter (name, slug, tier, status, timezone)
    values ('Test Chapter', ${'chapter-' + randomUUID()}, 'active', 'active', 'America/New_York')
    returning id
  `
  return row!.id as string
}

/** A mentor membership whose eligibility rows the tests exercise. */
async function makeMentorMembership(): Promise<string> {
  const account = await makeAccount()
  const chapter = await makeChapter()
  const [row] = await h.sql`
    insert into membership (account_id, chapter_id, role, status)
    values (${account}, ${chapter}, 'junior_mentor', 'active') returning id
  `
  return row!.id as string
}

// ---------------------------------------------------------------------------
describe('mentor_eligibility shape and enums', () => {
  test('a clearance row inserts with component, membership, cleared/expiry', async () => {
    const membership = await makeMentorMembership()
    const [row] = await h.sql`
      insert into mentor_eligibility (membership_id, component, cleared_at, expires_at)
      values (${membership}, 'background_check', now(), now() + interval '365 days')
      returning id, cleared_at, seq
    `
    expect(row!.id).toBeTruthy()
    expect(row!.cleared_at).not.toBeNull()
    expect(row!.seq).toBeTruthy()
  })

  test('component is a checked enum: garbage is rejected', async () => {
    const membership = await makeMentorMembership()
    await expect(h.sql`
      insert into mentor_eligibility (membership_id, component, cleared_at)
      values (${membership}, 'not_a_component', now())
    `).rejects.toThrow(/invalid input value for enum/i)
  })

  test('all four components are accepted', async () => {
    const membership = await makeMentorMembership()
    for (const c of [
      'background_check',
      'mandatory_reporter_training',
      'cwru_affiliation_verified',
      'signed_code_of_conduct',
    ]) {
      const [row] = await h.sql`
        insert into mentor_eligibility (membership_id, component, cleared_at)
        values (${membership}, ${c}, now()) returning id
      `
      expect(row!.id).toBeTruthy()
    }
  })

  test('membership fk is checked', async () => {
    await expect(h.sql`
      insert into mentor_eligibility (membership_id, component, cleared_at)
      values (${randomUUID()}, 'background_check', now())
    `).rejects.toThrow(/foreign key|violates/i)
  })

  test('version + evidence_ref are optional columns that persist', async () => {
    const membership = await makeMentorMembership()
    const [row] = await h.sql`
      insert into mentor_eligibility (membership_id, component, cleared_at, version, evidence_ref)
      values (${membership}, 'signed_code_of_conduct', now(), 'v2026.1', 'artifact://coc.pdf')
      returning version, evidence_ref
    `
    expect(row!.version).toBe('v2026.1')
    expect(row!.evidence_ref).toBe('artifact://coc.pdf')
  })
})

// ---------------------------------------------------------------------------
describe('mentor_eligibility_current projection', () => {
  test('active iff the latest per-component row is non-expired', async () => {
    const membership = await makeMentorMembership()
    await h.sql`
      insert into mentor_eligibility (membership_id, component, cleared_at, expires_at)
      values (${membership}, 'background_check', now(), now() + interval '90 days')
    `
    const [cur] = await h.sql`
      select active from mentor_eligibility_current
      where membership_id = ${membership} and component = 'background_check'
    `
    expect(cur!.active).toBe(true)
  })

  test('an expired latest row is not active', async () => {
    const membership = await makeMentorMembership()
    await h.sql`
      insert into mentor_eligibility (membership_id, component, cleared_at, expires_at)
      values (${membership}, 'background_check', now() - interval '400 days', now() - interval '10 days')
    `
    const [cur] = await h.sql`
      select active from mentor_eligibility_current
      where membership_id = ${membership} and component = 'background_check'
    `
    expect(cur!.active).toBe(false)
  })

  test('a later renewal row supersedes an earlier expired one', async () => {
    const membership = await makeMentorMembership()
    await h.sql`
      insert into mentor_eligibility (membership_id, component, cleared_at, expires_at)
      values (${membership}, 'background_check', now() - interval '400 days', now() - interval '10 days')
    `
    await h.sql`
      insert into mentor_eligibility (membership_id, component, cleared_at, expires_at)
      values (${membership}, 'background_check', now(), now() + interval '365 days')
    `
    const [cur] = await h.sql`
      select active from mentor_eligibility_current
      where membership_id = ${membership} and component = 'background_check'
    `
    expect(cur!.active).toBe(true)
  })
})

// ---------------------------------------------------------------------------
describe('append-only enforcement on mentor_eligibility', () => {
  test('UPDATE is rejected by the trigger (even as owner)', async () => {
    const membership = await makeMentorMembership()
    const [row] = await h.sql`
      insert into mentor_eligibility (membership_id, component, cleared_at)
      values (${membership}, 'background_check', now()) returning id
    `
    await expect(
      h.sql`update mentor_eligibility set expires_at = now() where id = ${row!.id}`,
    ).rejects.toThrow(/append-only/i)
  })

  test('DELETE is rejected by the trigger (even as owner)', async () => {
    const membership = await makeMentorMembership()
    const [row] = await h.sql`
      insert into mentor_eligibility (membership_id, component, cleared_at)
      values (${membership}, 'background_check', now()) returning id
    `
    await expect(h.sql`delete from mentor_eligibility where id = ${row!.id}`).rejects.toThrow(
      /append-only/i,
    )
  })
})

// ---------------------------------------------------------------------------
describe('Mechanism A: grants on mentor_eligibility', () => {
  test('app may SELECT/INSERT but not UPDATE/DELETE', async () => {
    const membership = await makeMentorMembership()
    const app = h.connectAs('curiolab_app', 'app_pw')
    const rows = await app`
      insert into mentor_eligibility (membership_id, component, cleared_at)
      values (${membership}, 'background_check', now()) returning id
    `
    expect(rows.length).toBe(1)
    const read = await app`select id from mentor_eligibility where id = ${rows[0]!.id}`
    expect(read.length).toBe(1)
    await expect(
      app`update mentor_eligibility set version = 'x' where id = ${rows[0]!.id}`,
    ).rejects.toThrow(/permission denied|append-only/i)
    await expect(app`delete from mentor_eligibility where id = ${rows[0]!.id}`).rejects.toThrow(
      /permission denied|append-only/i,
    )
  })

  test('analytics is denied SELECT on mentor_eligibility (default-deny)', async () => {
    const membership = await makeMentorMembership()
    await h.sql`
      insert into mentor_eligibility (membership_id, component, cleared_at)
      values (${membership}, 'background_check', now())
    `
    const analytics = h.connectAs('curiolab_analytics', 'analytics_pw')
    await expect(analytics`select 1 from mentor_eligibility limit 1`).rejects.toThrow(
      /permission denied/i,
    )
  })
})
