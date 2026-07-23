// -------------------------------------------------------------------------
// Milestone 3.5 — newsletter_issue / newsletter_item schema guarantees.
//
// The additive migration 0016_newsletter.sql adds newsletter_issue and
// newsletter_item. These tests are the red-before-green witnesses for its
// guarantees: the issue status enum/default discipline, a NULL chapter_id
// (platform-wide) issue, foreign-key resolution (chapter_id, published_by,
// issue_id), the nullable author_student_account_id (a staff-written item), and
// the Mechanism-A grants (app DML; analytics default-deny — a newsletter quotes
// and names minors, so the analytics read role must not reach it directly).
//
// TDD: run with CURIOLAB_MIGRATE_UPTO=0015 to witness these fail (the relations
// do not exist yet); the default run applies 0016 and they pass. Reuses the
// shared embedded-Postgres harness exactly like project-media-schema.test.ts.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMinor } from './helpers/fixtures.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness({ uptoInclusive: process.env.CURIOLAB_MIGRATE_UPTO })
}, 240_000)

afterAll(async () => {
  await h?.end()
})

async function makeIssue(
  overrides: { chapterId?: string | null; status?: string } = {},
): Promise<string> {
  const chapterId =
    overrides.chapterId === undefined ? await makeChapter(h.sql) : overrides.chapterId
  const [row] = await h.sql`
    insert into newsletter_issue (chapter_id, title, body, status)
    values (${chapterId}, 'July Digest', 'Body copy', ${overrides.status ?? 'draft'})
    returning id
  `
  return row!.id as string
}

// ---------------------------------------------------------------------------
describe('newsletter_issue enum, defaults, and foreign keys', () => {
  test('a valid issue inserts and defaults status=draft', async () => {
    const chapter = await makeChapter(h.sql)
    const [row] = await h.sql`
      insert into newsletter_issue (chapter_id, title, body)
      values (${chapter}, 'First issue', 'Hello chapter')
      returning status
    `
    expect(row!.status).toBe('draft')
  })

  test('a platform-wide issue (chapter_id NULL) is accepted', async () => {
    const [row] = await h.sql`
      insert into newsletter_issue (chapter_id, title, body)
      values (${null}, 'Platform-wide', 'For everyone')
      returning id, chapter_id
    `
    expect(row!.id).toBeTruthy()
    expect(row!.chapter_id).toBeNull()
  })

  test('an invalid issue.status is rejected', async () => {
    const chapter = await makeChapter(h.sql)
    await expect(h.sql`
      insert into newsletter_issue (chapter_id, title, body, status)
      values (${chapter}, 'x', 'y', 'bogus')
    `).rejects.toThrow(/invalid input value for enum|newsletter_issue_status/i)
  })

  test('an issue referencing a non-existent chapter is rejected', async () => {
    await expect(h.sql`
      insert into newsletter_issue (chapter_id, title, body)
      values (${randomUUID()}, 'x', 'y')
    `).rejects.toThrow(/foreign key|violates/i)
  })

  test('an issue referencing a non-existent published_by is rejected', async () => {
    const chapter = await makeChapter(h.sql)
    await expect(h.sql`
      insert into newsletter_issue (chapter_id, title, body, status, published_by, published_at)
      values (${chapter}, 'x', 'y', 'published', ${randomUUID()}, now())
    `).rejects.toThrow(/foreign key|violates/i)
  })

  test('published_by / published_at may be set to a real account', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const [row] = await h.sql`
      insert into newsletter_issue (chapter_id, title, body, status, published_by, published_at)
      values (${chapter}, 'x', 'y', 'published', ${director}, now())
      returning published_by
    `
    expect(row!.published_by).toBe(director)
  })
})

// ---------------------------------------------------------------------------
describe('newsletter_item foreign keys and nullable author', () => {
  test('a student-authored item resolves its issue and author', async () => {
    const issue = await makeIssue()
    const student = await makeMinor(h.sql)
    const [row] = await h.sql`
      insert into newsletter_item (issue_id, author_student_account_id, ref, body)
      values (${issue}, ${student}, ${randomUUID()}, 'My robot won a prize')
      returning id, author_student_account_id
    `
    expect(row!.id).toBeTruthy()
    expect(row!.author_student_account_id).toBe(student)
  })

  test('a staff-written item (author_student_account_id NULL) is accepted', async () => {
    const issue = await makeIssue()
    const [row] = await h.sql`
      insert into newsletter_item (issue_id, author_student_account_id, body)
      values (${issue}, ${null}, 'A note from the director')
      returning author_student_account_id
    `
    expect(row!.author_student_account_id).toBeNull()
  })

  test('an item referencing a non-existent issue is rejected', async () => {
    const student = await makeMinor(h.sql)
    await expect(h.sql`
      insert into newsletter_item (issue_id, author_student_account_id, body)
      values (${randomUUID()}, ${student}, 'x')
    `).rejects.toThrow(/foreign key|violates/i)
  })

  test('an item referencing a non-existent author is rejected', async () => {
    const issue = await makeIssue()
    await expect(h.sql`
      insert into newsletter_item (issue_id, author_student_account_id, body)
      values (${issue}, ${randomUUID()}, 'x')
    `).rejects.toThrow(/foreign key|violates/i)
  })
})

// ---------------------------------------------------------------------------
describe('Mechanism A: grants on the M3.5 tables', () => {
  test('the analytics role is denied SELECT on newsletter_issue (default-deny stance)', async () => {
    await makeIssue()
    const analytics = h.connectAs('curiolab_analytics', 'analytics_pw')
    await expect(analytics`select 1 from newsletter_issue limit 1`).rejects.toThrow(
      /permission denied/i,
    )
  })

  test('the analytics role is denied SELECT on newsletter_item (default-deny stance)', async () => {
    const analytics = h.connectAs('curiolab_analytics', 'analytics_pw')
    await expect(analytics`select 1 from newsletter_item limit 1`).rejects.toThrow(
      /permission denied/i,
    )
  })

  test('the app role may read and write newsletter_issue (control)', async () => {
    const chapter = await makeChapter(h.sql)
    const app = h.connectAs('curiolab_app', 'app_pw')
    const rows = await app`
      insert into newsletter_issue (chapter_id, title, body)
      values (${chapter}, 'App-written', 'Body')
      returning id
    `
    expect(rows.length).toBe(1)
  })

  test('the app role may read newsletter_item (control)', async () => {
    const app = h.connectAs('curiolab_app', 'app_pw')
    const rows = await app`select 1 from newsletter_item limit 1`
    expect(Array.isArray(rows)).toBe(true)
  })
})
