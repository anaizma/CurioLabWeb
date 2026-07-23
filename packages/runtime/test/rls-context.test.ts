// -------------------------------------------------------------------------
// withRlsContext — the runtime seam for Mechanism B (Milestone 4.1).
//
// Production would connect as the restricted `curiolab_rls` role and open a
// transaction per request, setting the two GUCs the RLS policies (migration
// 0018_rls.sql) key on, then running the request's reads inside it. This is
// that seam. Here it is unit-tested against the restricted role so the SAME
// filtering the raw-SQL rls.test.ts proves also holds THROUGH the helper.
//
// Threading this GUC through every existing service read (activating RLS on the
// main app connection) is out of scope for M4.1 — see the migration header.
// -------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { Sql } from 'postgres'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMinor, makeMembership } from './helpers/fixtures.js'
import { withRlsContext } from '../src/rls.js'

let h: Harness
let rls: Sql

let chapterA: string
let chapterB: string
let studentA1: string
let studentB1: string
let director: string

async function seedConsent(sql: Sql, student: string): Promise<void> {
  await sql`
    insert into consent (student_account_id, type, action, source, effective_at, reason)
    values (${student}, 'platform_participation', 'grant', 'digital', now() - interval '1 day', 'standard')
  `
}

beforeAll(async () => {
  h = await startHarness()
  const sql = h.sql

  chapterA = await makeChapter(sql)
  chapterB = await makeChapter(sql)
  director = await makeAdult(sql)
  studentA1 = await makeMinor(sql)
  studentB1 = await makeMinor(sql)

  await makeMembership(sql, studentA1, chapterA, { role: 'student', status: 'active' })
  await makeMembership(sql, studentB1, chapterB, { role: 'student', status: 'active' })
  await makeMembership(sql, director, chapterA, { role: 'chapter_director', status: 'active' })

  await seedConsent(sql, studentA1)
  await seedConsent(sql, studentB1)

  rls = h.connectAs('curiolab_rls', 'rls_pw')
}, 240_000)

afterAll(async () => {
  await h?.end()
})

async function consentStudents(ctx: {
  accountId?: string | null
  isPlatform?: boolean
}): Promise<string[]> {
  return withRlsContext(rls, ctx, async (tx) => {
    const rows = await tx`select student_account_id from consent`
    return rows.map((r) => r.student_account_id as string)
  })
}

describe('withRlsContext sets the GUCs so RLS filters through the helper', () => {
  test('no accountId and not platform => fail-closed, zero rows', async () => {
    expect(await consentStudents({})).toEqual([])
  })

  test('a student accountId sees their own consent, not an unrelated one', async () => {
    const seen = await consentStudents({ accountId: studentA1 })
    expect(seen).toContain(studentA1)
    expect(seen).not.toContain(studentB1)
  })

  test('a chapter_director sees their chapter, not another', async () => {
    const seen = await consentStudents({ accountId: director })
    expect(seen).toContain(studentA1)
    expect(seen).not.toContain(studentB1)
  })

  test('isPlatform sees everything', async () => {
    const seen = await consentStudents({ isPlatform: true })
    expect(seen).toEqual(expect.arrayContaining([studentA1, studentB1]))
  })

  test('the callback result is returned from the transaction', async () => {
    const answer = await withRlsContext(rls, { accountId: studentA1 }, async () => 42)
    expect(answer).toBe(42)
  })
})
