// -------------------------------------------------------------------------
// 0034_application_form.sql — the editable, versioned, per-chapter application
// form definition (docs/platform/application-form-definition-spec.md).
//
// Red-before-green witnesses:
//   * application_form exists; chapter_id is nullable (the platform default);
//     unique(chapter_id, version) bites; the status CHECK bounds draft|published;
//     the published-at CHECK ties published_at to status='published';
//   * the platform-default row is seeded (chapter_id NULL, version 1, published)
//     with a definition carrying the parent + student sections;
//   * application_draft / application carry the (form_id, form_version) stamp;
//   * append-only at the role level: curiolab_app may SELECT/INSERT but not
//     UPDATE/DELETE application_form.
//
// TDD: run with CURIOLAB_MIGRATE_UPTO=0033 to witness these fail (the relation
// does not exist yet); the default run applies 0034 and they pass.
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
    values ('Test Chapter', ${'chapter-' + randomUUID()}, 'active', 'active', 'America/New_York')
    returning id
  `
  return row!.id as string
}

const MINIMAL_DEF = { version: 1, sections: [] }

describe('application_form table', () => {
  test('exists and stores a per-chapter versioned definition', async () => {
    const chapterId = await makeChapter()
    const [row] = await h.sql`
      insert into application_form (chapter_id, version, status, definition, published_at)
      values (${chapterId}, 1, 'published', ${h.sql.json(MINIMAL_DEF)}, now())
      returning id, chapter_id, version, status, definition, published_at, created_at
    `
    expect(row!.chapter_id).toBe(chapterId)
    expect(row!.version).toBe(1)
    expect(row!.status).toBe('published')
    expect(row!.published_at).not.toBeNull()
  })

  test('chapter_id is nullable — the platform default is seeded (version 1, published)', async () => {
    const [row] = await h.sql`
      select id, version, status, definition from application_form
      where chapter_id is null order by version desc limit 1
    `
    expect(row).toBeDefined()
    expect(row!.version).toBe(1)
    expect(row!.status).toBe('published')
    const def = row!.definition as { sections: { id: string; questions: unknown[] }[] }
    const sectionIds = def.sections.map((s) => s.id).sort()
    expect(sectionIds).toEqual(['parent', 'student'])
    const student = def.sections.find((s) => s.id === 'student')!
    // Seven allowlist-keyed student questions (override 1).
    expect(student.questions.length).toBe(7)
  })

  test('unique (chapter_id, version) bites', async () => {
    const chapterId = await makeChapter()
    await h.sql`
      insert into application_form (chapter_id, version, status, definition)
      values (${chapterId}, 1, 'draft', ${h.sql.json(MINIMAL_DEF)})
    `
    await expect(
      h.sql`
        insert into application_form (chapter_id, version, status, definition)
        values (${chapterId}, 1, 'draft', ${h.sql.json(MINIMAL_DEF)})
      `,
    ).rejects.toThrow()
  })

  test('status CHECK rejects an unknown status', async () => {
    const chapterId = await makeChapter()
    await expect(
      h.sql`
        insert into application_form (chapter_id, version, status, definition)
        values (${chapterId}, 9, 'archived', ${h.sql.json(MINIMAL_DEF)})
      `,
    ).rejects.toThrow()
  })

  test('a draft must not carry published_at; a published row must', async () => {
    const chapterId = await makeChapter()
    // draft with a published_at -> rejected
    await expect(
      h.sql`
        insert into application_form (chapter_id, version, status, definition, published_at)
        values (${chapterId}, 3, 'draft', ${h.sql.json(MINIMAL_DEF)}, now())
      `,
    ).rejects.toThrow()
    // published with no published_at -> rejected
    await expect(
      h.sql`
        insert into application_form (chapter_id, version, status, definition)
        values (${chapterId}, 4, 'published', ${h.sql.json(MINIMAL_DEF)})
      `,
    ).rejects.toThrow()
  })

  test('a published row cannot be UPDATEd or DELETEd by curiolab_app (append-only grant)', async () => {
    const chapterId = await makeChapter()
    const [row] = await h.sql`
      insert into application_form (chapter_id, version, status, definition, published_at)
      values (${chapterId}, 1, 'published', ${h.sql.json(MINIMAL_DEF)}, now())
      returning id
    `
    const app = h.connectAs('curiolab_app', 'app_pw')
    try {
      await expect(app`update application_form set version = 2 where id = ${row!.id}`).rejects.toThrow()
      await expect(app`delete from application_form where id = ${row!.id}`).rejects.toThrow()
      // but SELECT + INSERT are allowed
      const rows = await app`select id from application_form where id = ${row!.id}`
      expect(rows.length).toBe(1)
    } finally {
      await app.end({ timeout: 5 })
    }
  })
})

describe('application_draft / application version stamp (override 2)', () => {
  test('application_draft carries (form_id, form_version)', async () => {
    const chapterId = await makeChapter()
    const [form] = await h.sql`
      insert into application_form (chapter_id, version, status, definition, published_at)
      values (${chapterId}, 1, 'published', ${h.sql.json(MINIMAL_DEF)}, now())
      returning id
    `
    const [lead] = await h.sql`
      insert into application_lead (email, chapter, chapter_id, filler_role, status, expires_at)
      values (${`p-${randomUUID().slice(0, 8)}@example.test`}, 'code', ${chapterId}, 'parent', 'new', now() + interval '30 days')
      returning id
    `
    const [draft] = await h.sql`
      insert into application_draft (lead_id, parent_token_hash, phase, status, form_id, form_version)
      values (${lead!.id}, ${'hash'}, '2a', 'in_progress', ${form!.id}, 1)
      returning form_id, form_version
    `
    expect(draft!.form_id).toBe(form!.id)
    expect(draft!.form_version).toBe(1)
  })

  test('application carries (form_id, form_version)', async () => {
    const chapterId = await makeChapter()
    const [form] = await h.sql`
      insert into application_form (chapter_id, version, status, definition, published_at)
      values (${chapterId}, 1, 'published', ${h.sql.json(MINIMAL_DEF)}, now())
      returning id
    `
    const [app] = await h.sql`
      insert into application (
        kind, chapter_id, status, applicant_name, applicant_contact_email, form_id, form_version
      ) values (
        'student', ${chapterId}, 'submitted', 'Minor Testchild', ${'g@example.test'}, ${form!.id}, 1
      ) returning form_id, form_version
    `
    expect(app!.form_id).toBe(form!.id)
    expect(app!.form_version).toBe(1)
  })
})
