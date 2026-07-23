// -------------------------------------------------------------------------
// Milestone 2.1 — feed content schema guarantee tests (The Lab).
//
// The additive migration 0013_feed_content.sql adds post, comment, reaction,
// and the append-only timeline_entry. These tests are the red-before-green
// witnesses for its guarantees: the reaction uniqueness index, the
// timeline_entry append-only discipline (trigger backstop + the role-level
// REVOKE, mirroring consent/audit_entry), the post enum/nullability defaults,
// and the foreign keys.
//
// TDD: run with CURIOLAB_MIGRATE_UPTO=0012 to witness these fail (the feed
// tables do not exist yet); the default run applies 0013 and they pass. Reuses
// the shared embedded-Postgres harness (one server per package, per-file
// template clone) exactly like db-guarantees.test.ts.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMembership, makePod, makeTerm } from './helpers/fixtures.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness({ uptoInclusive: process.env.CURIOLAB_MIGRATE_UPTO })
}, 240_000)

afterAll(async () => {
  await h?.end()
})

/** A chapter plus an active in-scope authoring membership (an instructor, so the
 * student-DOB trigger is not in play — authorship is by membership regardless). */
async function author(): Promise<{ chapter: string; membership: string }> {
  const chapter = await makeChapter(h.sql)
  const account = await makeAdult(h.sql)
  const membership = await makeMembership(h.sql, account, chapter, {
    role: 'lead_instructor',
    status: 'active',
  })
  return { chapter, membership }
}

async function makePost(
  chapter: string,
  membership: string,
  overrides: { type?: string; body?: string } = {},
): Promise<string> {
  const [row] = await h.sql`
    insert into post (chapter_id, author_membership_id, type, body)
    values (${chapter}, ${membership}, ${overrides.type ?? 'wip'}, ${overrides.body ?? 'Hello Lab'})
    returning id
  `
  return row!.id as string
}

// ---------------------------------------------------------------------------
describe('post enum, nullability, and defaults', () => {
  test('a valid post inserts and defaults status=published, system_generated=false', async () => {
    const { chapter, membership } = await author()
    const [row] = await h.sql`
      insert into post (chapter_id, author_membership_id, type, body)
      values (${chapter}, ${membership}, 'wip', 'First post')
      returning status, system_generated
    `
    expect(row!.status).toBe('published')
    expect(row!.system_generated).toBe(false)
  })

  test('an invalid post.type is rejected', async () => {
    const { chapter, membership } = await author()
    await expect(makePost(chapter, membership, { type: 'not_a_type' })).rejects.toThrow(
      /invalid input value for enum|post_type/i,
    )
  })

  test('an invalid post.status is rejected', async () => {
    const { chapter, membership } = await author()
    await expect(h.sql`
      insert into post (chapter_id, author_membership_id, type, body, status)
      values (${chapter}, ${membership}, 'wip', 'x', 'bogus')
    `).rejects.toThrow(/invalid input value for enum|content_status/i)
  })

  test('a pod-scoped post accepts a real pod_id (control)', async () => {
    const { chapter, membership } = await author()
    const term = await makeTerm(h.sql, chapter)
    const pod = await makePod(h.sql, chapter, term)
    const rows = await h.sql`
      insert into post (chapter_id, pod_id, author_membership_id, type, body)
      values (${chapter}, ${pod}, ${membership}, 'session_recap', 'recap')
      returning id
    `
    expect(rows.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
describe('post foreign keys resolve', () => {
  test('a post referencing a real chapter and membership is accepted (control)', async () => {
    const { chapter, membership } = await author()
    const id = await makePost(chapter, membership)
    expect(id).toBeTruthy()
  })

  test('a post referencing a non-existent chapter is rejected', async () => {
    const { membership } = await author()
    await expect(h.sql`
      insert into post (chapter_id, author_membership_id, type, body)
      values (${randomUUID()}, ${membership}, 'wip', 'x')
    `).rejects.toThrow(/foreign key|violates/i)
  })

  test('a post referencing a non-existent author membership is rejected', async () => {
    const { chapter } = await author()
    await expect(h.sql`
      insert into post (chapter_id, author_membership_id, type, body)
      values (${chapter}, ${randomUUID()}, 'wip', 'x')
    `).rejects.toThrow(/foreign key|violates/i)
  })
})

// ---------------------------------------------------------------------------
describe('reaction uniqueness', () => {
  test('a duplicate (target_type, target_id, membership_id, kind) is rejected', async () => {
    const { chapter, membership } = await author()
    const post = await makePost(chapter, membership)
    await h.sql`
      insert into reaction (target_type, target_id, membership_id, kind)
      values ('post', ${post}, ${membership}, 'like')
    `
    await expect(h.sql`
      insert into reaction (target_type, target_id, membership_id, kind)
      values ('post', ${post}, ${membership}, 'like')
    `).rejects.toThrow(/duplicate|unique/i)
  })

  test('a different kind on the same target by the same member is allowed', async () => {
    const { chapter, membership } = await author()
    const post = await makePost(chapter, membership)
    await h.sql`
      insert into reaction (target_type, target_id, membership_id, kind)
      values ('post', ${post}, ${membership}, 'like')
    `
    const rows = await h.sql`
      insert into reaction (target_type, target_id, membership_id, kind)
      values ('post', ${post}, ${membership}, 'celebrate')
      returning id
    `
    expect(rows.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
describe('timeline_entry is append-only', () => {
  async function anEntry(): Promise<string> {
    const account = await makeAdult(h.sql)
    const [row] = await h.sql`
      insert into timeline_entry (account_id, kind, occurred_at)
      values (${account}, 'joined', now())
      returning id
    `
    return row!.id as string
  }

  test('owner UPDATE raises the append-only trigger', async () => {
    const id = await anEntry()
    await expect(
      h.sql`update timeline_entry set kind = 'tampered' where id = ${id}`,
    ).rejects.toThrow(/append-only/i)
  })

  test('owner DELETE raises the append-only trigger', async () => {
    const id = await anEntry()
    await expect(h.sql`delete from timeline_entry where id = ${id}`).rejects.toThrow(
      /append-only/i,
    )
  })

  test('the app role is denied UPDATE and DELETE at the grant level', async () => {
    const id = await anEntry()
    const app = h.connectAs('curiolab_app', 'app_pw')
    await expect(
      app`update timeline_entry set kind = 'tampered' where id = ${id}`,
    ).rejects.toThrow(/permission denied/i)
    await expect(app`delete from timeline_entry where id = ${id}`).rejects.toThrow(
      /permission denied/i,
    )
  })

  test('the app role may still INSERT a timeline_entry (control)', async () => {
    const account = await makeAdult(h.sql)
    const app = h.connectAs('curiolab_app', 'app_pw')
    const rows = await app`
      insert into timeline_entry (account_id, kind, occurred_at)
      values (${account}, 'initial_explorer', now())
      returning id
    `
    expect(rows.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
describe('Mechanism A: analytics role is ungranted on the feed tables', () => {
  test('the analytics role is denied SELECT on post (default-deny stance)', async () => {
    const analytics = h.connectAs('curiolab_analytics', 'analytics_pw')
    await expect(analytics`select 1 from post limit 1`).rejects.toThrow(/permission denied/i)
  })

  test('the app role may read post (control)', async () => {
    const app = h.connectAs('curiolab_app', 'app_pw')
    const rows = await app`select 1 from post limit 1`
    expect(Array.isArray(rows)).toBe(true)
  })
})
