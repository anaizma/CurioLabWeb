// -------------------------------------------------------------------------
// Milestone 2.4 — moderation_report schema guarantee tests (The Lab).
//
// The additive migration 0014_moderation.sql adds the moderation_report table
// per 02-data-model.md. These are the red-before-green witnesses for its
// guarantees: the GENERATED due_at (24h for `safety`, 72h for `ordinary`), the
// enum/nullability discipline, the partial index `(due_at) WHERE resolved_at IS
// NULL`, and the Mechanism-A grants (the app role gets DML; the analytics role
// is default-denied SELECT, mirroring the other sensitive tables).
//
// TDD: run with CURIOLAB_MIGRATE_UPTO=0013 to witness these fail (the table does
// not exist yet); the default run applies 0014 and they pass. Reuses the shared
// embedded-Postgres harness exactly like feed-content.test.ts.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMembership } from './helpers/fixtures.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness({ uptoInclusive: process.env.CURIOLAB_MIGRATE_UPTO })
}, 240_000)

afterAll(async () => {
  await h?.end()
})

/** A chapter plus a reporter account (accounts are the reporter, per the model). */
async function reporter(): Promise<{ chapter: string; account: string }> {
  const chapter = await makeChapter(h.sql)
  const account = await makeAdult(h.sql)
  await makeMembership(h.sql, account, chapter, { role: 'senior_instructor', status: 'active' })
  return { chapter, account }
}

/** File a report with an explicit filed_at, returning the whole row. */
async function fileReport(
  chapter: string,
  account: string,
  klass: 'safety' | 'ordinary',
  overrides: { reason?: string; filedAt?: string } = {},
) {
  const [row] = await h.sql`
    insert into moderation_report (
      target_type, target_id, reporter_account_id, chapter_id, class, reason, filed_at
    ) values (
      'post', ${randomUUID()}, ${account}, ${chapter}, ${klass},
      ${overrides.reason ?? 'harmful'}, ${overrides.filedAt ?? h.sql`now()`}
    )
    returning *
  `
  return row!
}

// ---------------------------------------------------------------------------
describe('moderation_report generated due_at (the SLA)', () => {
  test('a safety report is due 24 hours after filed_at', async () => {
    const { chapter, account } = await reporter()
    const row = await fileReport(chapter, account, 'safety', { filedAt: '2099-01-01T00:00:00Z' })
    const filed = new Date(row.filed_at as string).getTime()
    const due = new Date(row.due_at as string).getTime()
    expect(due - filed).toBe(24 * 60 * 60 * 1000)
  })

  test('an ordinary report is due 72 hours after filed_at', async () => {
    const { chapter, account } = await reporter()
    const row = await fileReport(chapter, account, 'ordinary', { filedAt: '2099-01-01T00:00:00Z' })
    const filed = new Date(row.filed_at as string).getTime()
    const due = new Date(row.due_at as string).getTime()
    expect(due - filed).toBe(72 * 60 * 60 * 1000)
  })

  test('due_at is generated (a client-supplied value is rejected)', async () => {
    const { chapter, account } = await reporter()
    await expect(h.sql`
      insert into moderation_report (
        target_type, target_id, reporter_account_id, chapter_id, class, reason, filed_at, due_at
      ) values (
        'post', ${randomUUID()}, ${account}, ${chapter}, 'safety', 'harmful', now(), now()
      )
    `).rejects.toThrow(/generated|cannot insert/i)
  })
})

// ---------------------------------------------------------------------------
describe('moderation_report enums, nullability, defaults', () => {
  test('a valid report defaults the lifecycle timestamps to null', async () => {
    const { chapter, account } = await reporter()
    const row = await fileReport(chapter, account, 'ordinary')
    expect(row.acknowledged_at).toBeNull()
    expect(row.resolved_at).toBeNull()
    expect(row.resolver_account_id).toBeNull()
    expect(row.resolver_membership_id).toBeNull()
    expect(row.action_taken).toBeNull()
    expect(row.escalated_at).toBeNull()
    expect(row.escalated_to).toBeNull()
  })

  test('an invalid class is rejected', async () => {
    const { chapter, account } = await reporter()
    await expect(fileReport(chapter, account, 'bogus' as 'safety')).rejects.toThrow(
      /invalid input value for enum|moderation_class/i,
    )
  })

  test('an invalid reason is rejected', async () => {
    const { chapter, account } = await reporter()
    await expect(fileReport(chapter, account, 'safety', { reason: 'not_a_reason' })).rejects.toThrow(
      /invalid input value for enum|moderation_reason/i,
    )
  })

  test('an invalid target_type is rejected', async () => {
    const { chapter, account } = await reporter()
    await expect(h.sql`
      insert into moderation_report (target_type, target_id, reporter_account_id, chapter_id, class, reason, filed_at)
      values ('bogus', ${randomUUID()}, ${account}, ${chapter}, 'safety', 'harmful', now())
    `).rejects.toThrow(/invalid input value for enum|moderation_target_type/i)
  })

  test('an invalid action_taken is rejected', async () => {
    const { chapter, account } = await reporter()
    const row = await fileReport(chapter, account, 'ordinary')
    await expect(h.sql`
      update moderation_report set action_taken = 'bogus' where id = ${row.id as string}
    `).rejects.toThrow(/invalid input value for enum|moderation_action/i)
  })

  test('a report referencing a non-existent reporter account is rejected (fk)', async () => {
    const { chapter } = await reporter()
    await expect(h.sql`
      insert into moderation_report (target_type, target_id, reporter_account_id, chapter_id, class, reason, filed_at)
      values ('post', ${randomUUID()}, ${randomUUID()}, ${chapter}, 'safety', 'harmful', now())
    `).rejects.toThrow(/foreign key|violates/i)
  })
})

// ---------------------------------------------------------------------------
describe('moderation_report partial index and SLA query', () => {
  test('the partial index on (due_at) WHERE resolved_at IS NULL exists', async () => {
    const rows = await h.sql`
      select indexdef from pg_indexes
      where tablename = 'moderation_report' and indexdef ilike '%where (resolved_at is null)%'
    `
    expect(rows.length).toBeGreaterThanOrEqual(1)
  })

  test('SLA met is queryable as resolved_at <= due_at', async () => {
    const { chapter, account } = await reporter()
    const row = await fileReport(chapter, account, 'safety', { filedAt: '2099-01-01T00:00:00Z' })
    // resolve within the 24h window (met) — 1h after filing.
    await h.sql`update moderation_report set resolved_at = '2099-01-01T01:00:00Z' where id = ${row.id as string}`
    const [met] = await h.sql`
      select (resolved_at <= due_at) as sla_met from moderation_report where id = ${row.id as string}
    `
    expect(met!.sla_met).toBe(true)
  })
})

// ---------------------------------------------------------------------------
describe('Mechanism A grants on moderation_report', () => {
  test('the analytics role is denied SELECT (default-deny stance)', async () => {
    const analytics = h.connectAs('curiolab_analytics', 'analytics_pw')
    await expect(analytics`select 1 from moderation_report limit 1`).rejects.toThrow(
      /permission denied/i,
    )
  })

  test('the app role may INSERT and SELECT moderation_report (control)', async () => {
    const { chapter, account } = await reporter()
    const app = h.connectAs('curiolab_app', 'app_pw')
    const rows = await app`
      insert into moderation_report (target_type, target_id, reporter_account_id, chapter_id, class, reason, filed_at)
      values ('post', ${randomUUID()}, ${account}, ${chapter}, 'safety', 'harmful', now())
      returning id
    `
    expect(rows.length).toBe(1)
    const read = await app`select 1 from moderation_report limit 1`
    expect(Array.isArray(read)).toBe(true)
  })
})
