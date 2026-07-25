// -------------------------------------------------------------------------
// account.school column (migration 0038) — the first-class, nullable, student
// editable `school` field for the "My Information" self-service surface.
//
// The GET /api/account read returns account.school when set, else FALLS BACK to
// the student's application_draft.parent_answers.schoolName (so pre-existing
// students show their funnel value without a data migration); PATCH /api/account
// (students only) writes account.school. This schema test only asserts the
// column exists and is a nullable text column — the fallback + write behavior is
// exercised by the app-layer AccountService suite.
//
// TDD: run with CURIOLAB_MIGRATE_UPTO=0037 to witness this fail (the column does
// not exist yet); the default run applies 0038 and it passes.
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

async function makeStudent(dob = '2011-01-01'): Promise<string> {
  const [s] = await h.sql`
    insert into account (
      email, username, legal_name, display_name, date_of_birth,
      dob_provenance, dob_source_ref, credential_owner, status, maturation_state
    ) values (
      ${null}, ${`st-${randomUUID().slice(0, 8)}`}, 'Minor Testchild', 'Minor T.',
      ${dob}, 'enrollment_record', ${randomUUID()}, 'guardian_provisioned', 'active', 'minor'
    ) returning id
  `
  return s!.id as string
}

describe('account.school column', () => {
  test('a nullable school column exists and defaults to null (unset)', async () => {
    const student = await makeStudent()
    const [row] = await h.sql`select school from account where id = ${student}`
    expect(row!.school).toBeNull()
  })

  test('school holds a free-text school name once written', async () => {
    const student = await makeStudent()
    await h.sql`update account set school = ${'Shaker Heights High School'} where id = ${student}`
    const [row] = await h.sql`select school from account where id = ${student}`
    expect(row!.school).toBe('Shaker Heights High School')
  })

  test('school is DISTINCT from the identity columns (email/username untouched)', async () => {
    const student = await makeStudent()
    await h.sql`update account set school = ${'Synthetic Academy'} where id = ${student}`
    const [row] = await h.sql`select email, username, school from account where id = ${student}`
    expect(row!.email).toBeNull()
    expect(row!.username).not.toBeNull()
    expect(row!.school).toBe('Synthetic Academy')
  })
})
