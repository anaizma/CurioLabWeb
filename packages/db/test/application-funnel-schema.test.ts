// -------------------------------------------------------------------------
// Application-funnel schema tests (Milestone 1 v2, part A) — the two new
// tables the reworked public funnel needs: `application_lead` (Stage 1, the
// public parent-email write) and `application_draft` (Stage 2 persistence,
// populated by part B, created here as the table). Embedded Postgres,
// synthetic data.
//
// TDD: with migration 0010 absent (CURIOLAB_MIGRATE_UPTO=0009) the relations do
// not exist and every insert here fails; adding 0010 turns them green.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeApplication, makeChapter } from './helpers/fixtures.js'

let h: Harness

beforeAll(async () => {
  // CURIOLAB_MIGRATE_UPTO=0009 applies every migration EXCEPT 0010 and witnesses
  // the red state (the relations do not exist); the default run applies 0010.
  h = await startHarness({ uptoInclusive: process.env.CURIOLAB_MIGRATE_UPTO })
}, 240_000)

afterAll(async () => {
  await h?.end()
})

async function makeLead(
  overrides: Partial<{ email: string; chapterId: string | null; referralSource: string; status: string }> = {},
): Promise<string> {
  const chapterId = overrides.chapterId === undefined ? await makeChapter(h.sql) : overrides.chapterId
  const [row] = await h.sql`
    insert into application_lead (email, chapter_id, referral_source, status)
    values (
      ${overrides.email ?? `parent-${randomUUID()}@example.test`}, ${chapterId},
      ${overrides.referralSource ?? 'instagram'}, ${overrides.status ?? 'new'}
    ) returning id
  `
  return row!.id as string
}

describe('application_lead — the Stage 1 public parent-email write', () => {
  test('a minimal lead carries email/chapter/referral and defaults to status new', async () => {
    const chapter = await makeChapter(h.sql)
    const [row] = await h.sql`
      insert into application_lead (email, chapter_id, referral_source)
      values ('Parent@Example.Test', ${chapter}, 'a friend')
      returning id, email, chapter_id, referral_source, status, token_hash,
                converted_application_id, created_at, deleted_at
    `
    expect(row!.status).toBe('new')
    expect(row!.token_hash).toBeNull()
    expect(row!.converted_application_id).toBeNull()
    expect(row!.deleted_at).toBeNull()
    expect(row!.chapter_id).toBe(chapter)
    expect(row!.created_at).not.toBeNull()
  })

  test('email is citext (case-insensitive lookup)', async () => {
    await makeLead({ email: 'MixedCase@Example.Test' })
    const rows = await h.sql`select id from application_lead where email = ${'mixedcase@example.test'}`
    expect(rows.length).toBeGreaterThanOrEqual(1)
  })

  test('chapter_id is nullable (a lead need not name a chapter)', async () => {
    const id = await makeLead({ chapterId: null })
    const [row] = await h.sql`select chapter_id from application_lead where id = ${id}`
    expect(row!.chapter_id).toBeNull()
  })

  test('status accepts each lifecycle value', async () => {
    for (const status of ['new', 'stage2_started', 'converted', 'deleted'] as const) {
      const id = await makeLead({ status })
      const [row] = await h.sql`select status from application_lead where id = ${id}`
      expect(row!.status).toBe(status)
    }
  })

  test('an unknown status value is rejected by the enum', async () => {
    await expect(makeLead({ status: 'nonsense' })).rejects.toThrow(/invalid input value for enum|application_lead_status/i)
  })

  test('converted_application_id references application when set', async () => {
    const chapter = await makeChapter(h.sql)
    const appId = await makeApplication(h.sql, chapter, 'parent@example.test')
    const [row] = await h.sql`
      insert into application_lead (email, chapter_id, referral_source, status, converted_application_id)
      values (${`p-${randomUUID()}@example.test`}, ${chapter}, 'referral', 'converted', ${appId})
      returning converted_application_id
    `
    expect(row!.converted_application_id).toBe(appId)
  })

  test('a dangling converted_application_id is rejected by the FK', async () => {
    await expect(
      h.sql`
        insert into application_lead (email, referral_source, converted_application_id)
        values (${`p-${randomUUID()}@example.test`}, 'x', ${randomUUID()})
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
