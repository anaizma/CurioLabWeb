// -------------------------------------------------------------------------
// Application-funnel schema tests (Milestone 1, part A) — the two funnel
// tables after the Stage-1 design alignment (migration 0012):
//   `application_lead`  (Stage 1, the public parent-email write) and
//   `application_draft` (Stage 2 persistence, populated by part B).
// Embedded Postgres, synthetic data.
//
// The Stage-1 design (docs/superpowers/specs/2026-07-22-application-funnel-
// stage-1-design.md §7.1) is the authority for `application_lead`: a `chapter`
// TEXT CODE (not an fk, so "interested in another school" is expressible), an
// OPTIONAL `source`, a NOT-NULL `filler_role`, a `token_hash` issued at lead
// creation, `expires_at` (created_at + 30 days), and a `converted_at` marker.
//
// TDD: with migration 0012 absent (CURIOLAB_MIGRATE_UPTO=0011) the new columns
// do not exist and every insert here fails; adding 0012 turns them green.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeApplication, makeChapter } from './helpers/fixtures.js'

let h: Harness

beforeAll(async () => {
  // CURIOLAB_MIGRATE_UPTO=0011 applies every migration EXCEPT 0012 and witnesses
  // the red state (the new columns do not exist); the default run applies 0012.
  h = await startHarness({ uptoInclusive: process.env.CURIOLAB_MIGRATE_UPTO })
}, 240_000)

afterAll(async () => {
  await h?.end()
})

async function makeLead(
  overrides: Partial<{
    email: string
    chapter: string
    chapterId: string | null
    source: string | null
    fillerRole: string
    status: string
  }> = {},
): Promise<string> {
  const [row] = await h.sql`
    insert into application_lead (email, chapter, chapter_id, source, filler_role, status)
    values (
      ${overrides.email ?? `parent-${randomUUID()}@example.test`},
      ${overrides.chapter ?? 'case-western-reserve-university'},
      ${overrides.chapterId === undefined ? null : overrides.chapterId},
      ${overrides.source === undefined ? 'instagram' : overrides.source},
      ${overrides.fillerRole ?? 'parent'},
      ${overrides.status ?? 'new'}
    ) returning id
  `
  return row!.id as string
}

describe('application_lead — the Stage 1 public parent-email write (design §7.1)', () => {
  test('a minimal lead carries email/chapter-code/filler_role, defaults status new, and gets a 30-day expiry', async () => {
    const [row] = await h.sql`
      insert into application_lead (email, chapter, filler_role)
      values ('Parent@Example.Test', 'case-western-reserve-university', 'parent')
      returning id, email, chapter, chapter_id, source, filler_role, status,
                token_hash, converted_application_id, converted_at, created_at, expires_at
    `
    expect(row!.status).toBe('new')
    expect(row!.chapter).toBe('case-western-reserve-university')
    // chapter is a CODE, not an fk: chapter_id may be null (another school).
    expect(row!.chapter_id).toBeNull()
    // source is optional; filler_role drives the confirmation copy.
    expect(row!.source).toBeNull()
    expect(row!.filler_role).toBe('parent')
    expect(row!.token_hash).toBeNull()
    expect(row!.converted_application_id).toBeNull()
    expect(row!.converted_at).toBeNull()
    expect(row!.created_at).not.toBeNull()
    // expires_at defaults to created_at + 30 days (the retention/deletion floor).
    const days = (new Date(row!.expires_at).getTime() - new Date(row!.created_at).getTime()) / 86_400_000
    expect(Math.round(days)).toBe(30)
  })

  test('chapter is NOT NULL — a lead must name a chapter code', async () => {
    await expect(
      h.sql`insert into application_lead (email, filler_role) values ('x@example.test', 'parent')`,
    ).rejects.toThrow(/null value|not-null|violates/i)
  })

  test('chapter is a free text CODE (no fk) so "another school" is expressible', async () => {
    const id = await makeLead({ chapter: 'interested-in-another-school', chapterId: null })
    const [row] = await h.sql`select chapter, chapter_id from application_lead where id = ${id}`
    expect(row!.chapter).toBe('interested-in-another-school')
    expect(row!.chapter_id).toBeNull()
  })

  test('chapter_id (kept as an optional fk for the 2C linkage) references chapter when set', async () => {
    const chapter = await makeChapter(h.sql)
    const id = await makeLead({ chapterId: chapter })
    const [row] = await h.sql`select chapter_id from application_lead where id = ${id}`
    expect(row!.chapter_id).toBe(chapter)
  })

  test('a dangling chapter_id is rejected by the fk', async () => {
    await expect(makeLead({ chapterId: randomUUID() })).rejects.toThrow(/foreign key|violates/i)
  })

  test('source is nullable ("how did you hear" is optional)', async () => {
    const id = await makeLead({ source: null })
    const [row] = await h.sql`select source from application_lead where id = ${id}`
    expect(row!.source).toBeNull()
  })

  test('filler_role is NOT NULL and accepts only parent/student', async () => {
    for (const fillerRole of ['parent', 'student'] as const) {
      const id = await makeLead({ fillerRole })
      const [row] = await h.sql`select filler_role from application_lead where id = ${id}`
      expect(row!.filler_role).toBe(fillerRole)
    }
    await expect(makeLead({ fillerRole: 'teacher' })).rejects.toThrow(
      /invalid input value for enum|application_lead_filler_role/i,
    )
    await expect(
      h.sql`insert into application_lead (email, chapter) values ('n@example.test', 'c')`,
    ).rejects.toThrow(/null value|not-null|violates/i)
  })

  test('email is citext (case-insensitive lookup)', async () => {
    await makeLead({ email: 'MixedCase@Example.Test' })
    const rows = await h.sql`select id from application_lead where email = ${'mixedcase@example.test'}`
    expect(rows.length).toBeGreaterThanOrEqual(1)
  })

  test('status accepts each lifecycle value', async () => {
    for (const status of ['new', 'stage2_started', 'converted', 'deleted'] as const) {
      const id = await makeLead({ status })
      const [row] = await h.sql`select status from application_lead where id = ${id}`
      expect(row!.status).toBe(status)
    }
  })

  test('converted_at + converted_application_id record a Stage-2 conversion', async () => {
    const chapter = await makeChapter(h.sql)
    const appId = await makeApplication(h.sql, chapter, 'parent@example.test')
    const [row] = await h.sql`
      insert into application_lead (email, chapter, chapter_id, filler_role, status, converted_at, converted_application_id)
      values (${`p-${randomUUID()}@example.test`}, 'c', ${chapter}, 'parent', 'converted', now(), ${appId})
      returning converted_at, converted_application_id
    `
    expect(row!.converted_at).not.toBeNull()
    expect(row!.converted_application_id).toBe(appId)
  })

  test('a dangling converted_application_id is rejected by the FK', async () => {
    await expect(
      h.sql`
        insert into application_lead (email, chapter, filler_role, converted_application_id)
        values (${`p-${randomUUID()}@example.test`}, 'c', 'parent', ${randomUUID()})
      `,
    ).rejects.toThrow(/foreign key|violates/i)
  })
})

describe('application_draft — the Stage 2 persistence table (populated by part B)', () => {
  test('a draft binds to a lead and carries phase, status, token, and answers', async () => {
    const leadId = await makeLead()
    const [row] = await h.sql`
      insert into application_draft (
        lead_id, parent_token_hash, student_token_hash, phase, parent_answers, student_answers, status
      ) values (
        ${leadId}, ${'hash-parent'}, ${null}, '2a', ${h.sql.json({ childName: 'Minor Testchild' })},
        ${null}, 'in_progress'
      ) returning id, lead_id, parent_token_hash, student_token_hash, phase, status,
                  parent_answers, student_answers, converted_application_id, submitted_at, created_at
    `
    expect(row!.lead_id).toBe(leadId)
    expect(row!.phase).toBe('2a')
    expect(row!.status).toBe('in_progress')
    expect(row!.student_token_hash).toBeNull()
    expect(row!.converted_application_id).toBeNull()
    expect(row!.submitted_at).toBeNull()
    expect(row!.parent_answers).toMatchObject({ childName: 'Minor Testchild' })
  })

  test('phase accepts each stage-2 value', async () => {
    const leadId = await makeLead()
    for (const phase of ['2a', '2b', '2c', 'submitted'] as const) {
      const [row] = await h.sql`
        insert into application_draft (lead_id, parent_token_hash, phase, status)
        values (${leadId}, 'h', ${phase}, 'in_progress')
        returning phase
      `
      expect(row!.phase).toBe(phase)
    }
  })

  test('status accepts each draft-status value', async () => {
    const leadId = await makeLead()
    for (const status of ['in_progress', '2b_saved', 'sent_back', 'submitted'] as const) {
      const [row] = await h.sql`
        insert into application_draft (lead_id, parent_token_hash, phase, status)
        values (${leadId}, 'h', '2a', ${status})
        returning status
      `
      expect(row!.status).toBe(status)
    }
  })

  test('a draft with a dangling lead_id is rejected by the FK', async () => {
    await expect(
      h.sql`
        insert into application_draft (lead_id, parent_token_hash, phase, status)
        values (${randomUUID()}, 'h', '2a', 'in_progress')
      `,
    ).rejects.toThrow(/foreign key|violates/i)
  })
})
