// -------------------------------------------------------------------------
// admin/director backend §8 — access_ledger schema guarantees.
//
// The additive migration 0022_access_ledger.sql adds the append-only
// invitation/access-provenance ledger, a PEER of audit_entry. These tests are
// the red-before-green witnesses for the migration's guarantees:
//   * the table exists; event is NOT NULL; chapter_id / account fks are checked;
//   * client_ip is an inet (accepts an address, rejects garbage);
//   * append-only: UPDATE and DELETE are rejected by the trigger (even as the
//     table owner), the same backstop consent / audit_entry carry;
//   * the Mechanism-A grants: the app role may SELECT/INSERT but NOT UPDATE/DELETE
//     (the role-level belt), and the analytics read role is denied SELECT
//     (default-deny — origination data, like enrollment_record / guardianship).
//
// TDD: run with CURIOLAB_MIGRATE_UPTO=0021 to witness these fail (the relation
// does not exist yet); the default run applies 0022 and they pass.
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

async function makeChapter(): Promise<string> {
  const [row] = await h.sql`
    insert into chapter (name, slug, tier, status, timezone)
    values ('Ledger Chapter', ${`ledger-${randomUUID().slice(0, 8)}`}, 'seed', 'active', 'America/New_York')
    returning id
  `
  return row!.id as string
}

async function makeAccount(): Promise<string> {
  const [row] = await h.sql`
    insert into account (
      email, username, legal_name, display_name, date_of_birth,
      dob_provenance, dob_source_ref, credential_owner, status, maturation_state
    ) values (
      ${`al-${randomUUID().slice(0, 8)}@example.test`}, ${null}, 'Adult Testperson', 'Adult T.',
      '1990-01-01', 'self_reported', ${null}, 'self_private', 'active', 'self_managed'
    ) returning id
  `
  return row!.id as string
}

// ---------------------------------------------------------------------------
describe('access_ledger shape and constraints', () => {
  test('a row inserts with an event, chapter, actor, subject, and client_ip', async () => {
    const chapter = await makeChapter()
    const actor = await makeAccount()
    const subject = await makeAccount()
    const [row] = await h.sql`
      insert into access_ledger (event, actor_account_id, subject_account_id, chapter_id, invite_kind, target_email, client_ip)
      values ('invite.issued', ${actor}, ${subject}, ${chapter}, 'guardian', 'parent@example.test', '203.0.113.7')
      returning id, at, detail, client_ip
    `
    expect(row!.id).toBeTruthy()
    expect(row!.at).not.toBeNull()
    expect(row!.detail).toEqual({})
    expect(String(row!.client_ip)).toBe('203.0.113.7')
  })

  test('event is NOT NULL', async () => {
    await expect(h.sql`
      insert into access_ledger (event) values (${null})
    `).rejects.toThrow(/null value|not-null/i)
  })

  test('client_ip is an inet: garbage is rejected', async () => {
    await expect(h.sql`
      insert into access_ledger (event, client_ip) values ('x', 'not-an-ip')
    `).rejects.toThrow(/invalid input syntax for type inet/i)
  })

  test('a system event may carry a null actor and null client_ip', async () => {
    const [row] = await h.sql`
      insert into access_ledger (event, actor_account_id, client_ip)
      values ('membership.activated', ${null}, ${null}) returning id
    `
    expect(row!.id).toBeTruthy()
  })

  test('chapter_id is FK-checked', async () => {
    await expect(h.sql`
      insert into access_ledger (event, chapter_id) values ('invite.issued', ${randomUUID()})
    `).rejects.toThrow(/foreign key|violates/i)
  })
})

// ---------------------------------------------------------------------------
describe('append-only enforcement', () => {
  test('UPDATE is rejected by the trigger (even as owner)', async () => {
    const [row] = await h.sql`insert into access_ledger (event) values ('invite.issued') returning id`
    await expect(h.sql`update access_ledger set event = 'tampered' where id = ${row!.id}`).rejects.toThrow(
      /append-only/i,
    )
  })

  test('DELETE is rejected by the trigger (even as owner)', async () => {
    const [row] = await h.sql`insert into access_ledger (event) values ('invite.issued') returning id`
    await expect(h.sql`delete from access_ledger where id = ${row!.id}`).rejects.toThrow(/append-only/i)
  })
})

// ---------------------------------------------------------------------------
describe('Mechanism A: grants on access_ledger', () => {
  test('the analytics role is denied SELECT (default-deny — origination data)', async () => {
    await h.sql`insert into access_ledger (event) values ('invite.issued')`
    const analytics = h.connectAs('curiolab_analytics', 'analytics_pw')
    await expect(analytics`select 1 from access_ledger limit 1`).rejects.toThrow(/permission denied/i)
  })

  test('the app role may SELECT and INSERT but not UPDATE/DELETE', async () => {
    const app = h.connectAs('curiolab_app', 'app_pw')
    const rows = await app`insert into access_ledger (event) values ('invite.redeemed') returning id`
    expect(rows.length).toBe(1)
    const read = await app`select id from access_ledger where id = ${rows[0]!.id}`
    expect(read.length).toBe(1)
    // UPDATE/DELETE are REVOKEd at the role level (the belt to the trigger's braces).
    await expect(app`update access_ledger set event = 'x' where id = ${rows[0]!.id}`).rejects.toThrow(
      /permission denied|append-only/i,
    )
    await expect(app`delete from access_ledger where id = ${rows[0]!.id}`).rejects.toThrow(
      /permission denied|append-only/i,
    )
  })
})
