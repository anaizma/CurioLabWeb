// -------------------------------------------------------------------------
// Mechanism B: per-request row-level security (RLS), Milestone 4.1.
//
// These tests connect AS the NEW restricted role `curiolab_rls` (LOGIN, NO
// BYPASSRLS), which is the ONLY role subject to the policies added in migration
// 0018_rls.sql. The pre-existing app/owner connections (`curiolab_app`, the
// superuser owner) hold BYPASSRLS and are proven unaffected by the regression
// suite, not here.
//
// The policies key on two transaction-local settings, set with
// `set_config(name, value, true)` (is_local = true = SET LOCAL semantics):
//   app.current_account_id  — the acting account (uuid)
//   app.actor_is_platform   — 'on' => a platform actor sees everything
//
// When neither is set the policy denies (fail-closed): only curiolab_rls is
// subject, so this cannot affect the app path.
//
// All data is synthetic (obviously-fake names/dates per the test-data policy)
// and seeded as the superuser owner, which bypasses RLS.
// -------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { Sql } from 'postgres'
import { startHarness, type Harness } from './helpers/pg.js'
import {
  makeAdult,
  makeApplication,
  makeChapter,
  makeEnrollment,
  makeMembership,
  makeMinor,
  makeTerm,
} from './helpers/fixtures.js'

let h: Harness
let rls: Sql

// Chapters
let chapterA: string
let chapterB: string
// Accounts
let studentA1: string // student in chapter A
let studentA2: string // another student in chapter A
let studentB1: string // student in chapter B (the unrelated foil)
let director: string // chapter_director (active staff) in chapter A
let guardianG: string // verified guardian of studentA1 ONLY

async function seedConsent(sql: Sql, student: string): Promise<void> {
  // A digital platform_participation grant: no signed_form source_ref /
  // enrollment anchor required (0001/0003/0004), effective_at in the past.
  await sql`
    insert into consent (
      student_account_id, type, action, source, effective_at, reason
    ) values (
      ${student}, 'platform_participation', 'grant', 'digital',
      now() - interval '1 day', 'standard'
    )
  `
}

async function seedEnrollment(
  sql: Sql,
  student: string,
  chapterId: string,
  termId: string,
  creator: string,
): Promise<void> {
  const application = await makeApplication(sql, chapterId, 'guardian@example.test')
  // A returning-shape enrollment: carries the student account id (no second DOB).
  await makeEnrollment(sql, {
    applicationId: application,
    chapterId,
    termId,
    createdBy: creator,
    studentAccountId: student,
    dateOfBirth: null,
  })
}

beforeAll(async () => {
  h = await startHarness()
  const sql = h.sql

  chapterA = await makeChapter(sql)
  chapterB = await makeChapter(sql)
  const termA = await makeTerm(sql, chapterA)
  const termB = await makeTerm(sql, chapterB)

  director = await makeAdult(sql)
  guardianG = await makeAdult(sql)
  studentA1 = await makeMinor(sql)
  studentA2 = await makeMinor(sql)
  studentB1 = await makeMinor(sql)

  // Memberships: three students in their chapters, a chapter_director in A.
  await makeMembership(sql, studentA1, chapterA, { role: 'student', status: 'active' })
  await makeMembership(sql, studentA2, chapterA, { role: 'student', status: 'active' })
  await makeMembership(sql, studentB1, chapterB, { role: 'student', status: 'active' })
  await makeMembership(sql, director, chapterA, { role: 'chapter_director', status: 'active' })

  // A verified guardianship edge: guardianG -> studentA1 ONLY.
  await sql`
    insert into guardianship (
      guardian_account_id, student_account_id, relationship, status, verification_method
    ) values (
      ${guardianG}, ${studentA1}, 'parent', 'verified', 'signed_form_match'
    )
  `

  // Consents + enrollment records for each student.
  for (const s of [studentA1, studentA2, studentB1]) await seedConsent(sql, s)
  await seedEnrollment(sql, studentA1, chapterA, termA, director)
  await seedEnrollment(sql, studentA2, chapterA, termA, director)
  await seedEnrollment(sql, studentB1, chapterB, termB, director)

  rls = h.connectAs('curiolab_rls', 'rls_pw')
}, 240_000)

afterAll(async () => {
  await h?.end()
})

// --- helpers that run a read under a given RLS context ---------------------

interface Ctx {
  account?: string | null
  platform?: boolean
}

async function underCtx<T>(ctx: Ctx, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return rls.begin(async (tx) => {
    if (ctx.account != null) {
      await tx`select set_config('app.current_account_id', ${ctx.account}, true)`
    }
    if (ctx.platform) {
      await tx`select set_config('app.actor_is_platform', 'on', true)`
    }
    return fn(tx as unknown as Sql)
  }) as Promise<T>
}

async function consentStudents(ctx: Ctx): Promise<string[]> {
  return underCtx(ctx, async (tx) => {
    const rows = await tx`select student_account_id from consent`
    return rows.map((r) => r.student_account_id as string)
  })
}

async function membershipAccounts(ctx: Ctx): Promise<string[]> {
  return underCtx(ctx, async (tx) => {
    const rows = await tx`select account_id from membership`
    return rows.map((r) => r.account_id as string)
  })
}

async function enrollmentStudents(ctx: Ctx): Promise<string[]> {
  return underCtx(ctx, async (tx) => {
    const rows = await tx`select student_account_id from enrollment_record`
    return rows.map((r) => r.student_account_id as string)
  })
}

async function guardianshipStudents(ctx: Ctx): Promise<string[]> {
  return underCtx(ctx, async (tx) => {
    const rows = await tx`select student_account_id from guardianship`
    return rows.map((r) => r.student_account_id as string)
  })
}

// ---------------------------------------------------------------------------
describe('Mechanism B: RLS fail-closed with no GUC set', () => {
  test('a SELECT on consent returns ZERO rows when no GUC is set', async () => {
    // No transaction context: the GUC is unset, the policy denies everything.
    const rows = await rls`select student_account_id from consent`
    expect(rows.length).toBe(0)
  })

  test('a SELECT on membership returns ZERO rows when no GUC is set', async () => {
    const rows = await rls`select account_id from membership`
    expect(rows.length).toBe(0)
  })

  test('an unset account with actor_is_platform off still denies inside a txn', async () => {
    expect(await consentStudents({})).toEqual([])
    expect(await membershipAccounts({})).toEqual([])
  })
})

describe('Mechanism B: a student sees only their own rows', () => {
  test('studentA1 sees their own consent, not an unrelated student in another chapter', async () => {
    const seen = await consentStudents({ account: studentA1 })
    expect(seen).toContain(studentA1)
    expect(seen).not.toContain(studentB1)
    expect(seen).not.toContain(studentA2)
  })

  test('studentA1 sees their own membership, not the unrelated chapter-B student', async () => {
    const seen = await membershipAccounts({ account: studentA1 })
    expect(seen).toContain(studentA1)
    expect(seen).not.toContain(studentB1)
  })

  test('studentA1 sees their own enrollment_record, not the unrelated one', async () => {
    const seen = await enrollmentStudents({ account: studentA1 })
    expect(seen).toContain(studentA1)
    expect(seen).not.toContain(studentB1)
  })
})

describe('Mechanism B: a chapter_director sees their chapter', () => {
  test('director sees both chapter-A students consent, not chapter-B', async () => {
    const seen = await consentStudents({ account: director })
    expect(seen).toEqual(expect.arrayContaining([studentA1, studentA2]))
    expect(seen).not.toContain(studentB1)
  })

  test('director sees chapter-A memberships, not chapter-B memberships', async () => {
    const seen = await membershipAccounts({ account: director })
    expect(seen).toEqual(expect.arrayContaining([studentA1, studentA2, director]))
    expect(seen).not.toContain(studentB1)
  })

  test('director sees chapter-A enrollment records, not chapter-B', async () => {
    const seen = await enrollmentStudents({ account: director })
    expect(seen).toEqual(expect.arrayContaining([studentA1, studentA2]))
    expect(seen).not.toContain(studentB1)
  })
})

describe('Mechanism B: a platform actor sees everything', () => {
  test('actor_is_platform=on reveals all consent rows', async () => {
    const seen = await consentStudents({ platform: true })
    expect(seen).toEqual(expect.arrayContaining([studentA1, studentA2, studentB1]))
  })

  test('actor_is_platform=on reveals all memberships across chapters', async () => {
    const seen = await membershipAccounts({ platform: true })
    expect(seen).toEqual(
      expect.arrayContaining([studentA1, studentA2, studentB1, director]),
    )
  })
})

describe('Mechanism B: a guardian sees their child, not an unrelated child', () => {
  test('guardianG sees studentA1 consent but not studentA2 / studentB1', async () => {
    const seen = await consentStudents({ account: guardianG })
    expect(seen).toContain(studentA1)
    expect(seen).not.toContain(studentA2)
    expect(seen).not.toContain(studentB1)
  })

  test('guardianG sees the guardianship edge to studentA1 only', async () => {
    const seen = await guardianshipStudents({ account: guardianG })
    expect(seen).toEqual([studentA1])
  })

  test('guardianG sees studentA1 enrollment record, not others', async () => {
    const seen = await enrollmentStudents({ account: guardianG })
    expect(seen).toEqual([studentA1])
  })
})
