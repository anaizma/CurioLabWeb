// -------------------------------------------------------------------------
// Database guarantee test for the retention/deletion erase bypass
// (0009_retention_erase_bypass.sql; compliance-coppa.md 1.5 / Part 3 tiered
// deletion, 1.6 the parent's deletion right). The write-once DOB triggers
// (0006) forbid an ordinary UPDATE of account.date_of_birth /
// enrollment_record.date_of_birth. The deletion fulfillment service must be
// able to null/tombstone the DOB during an erase, so 0009 adds a SECOND
// sanctioned transaction-local GUC `app.retention_erase = 'on'` (distinct from
// `app.dob_correction`) that the write-once triggers also honour.
//
// TDD: with 0009 absent the "flagged erase succeeds" cases fail (the trigger
// still blocks the change); the control "an ordinary erase is still blocked"
// passes throughout. Applying 0009 turns the flagged cases green while leaving
// the control red-for-the-right-reason (blocked) intact.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeApplication, makeChapter, makeMinor, makeTerm } from './helpers/fixtures.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness({ uptoInclusive: process.env.CURIOLAB_MIGRATE_UPTO })
}, 240_000)

afterAll(async () => {
  await h?.end()
})

const DOB_TOMBSTONE = '1900-01-01'

describe('retention erase bypass — account.date_of_birth', () => {
  test('an ordinary erase of account.date_of_birth is still blocked (write-once)', async () => {
    const student = await makeMinor(h.sql)
    await expect(
      h.sql`update account set date_of_birth = ${DOB_TOMBSTONE} where id = ${student}`,
    ).rejects.toThrow(/write.?once|date_of_birth|dob/i)
  })

  test('an erase flagged app.retention_erase=on may tombstone the DOB', async () => {
    const student = await makeMinor(h.sql)
    await h.sql.begin(async (tx) => {
      await tx`set local app.retention_erase = 'on'`
      await tx`update account set date_of_birth = ${DOB_TOMBSTONE} where id = ${student}`
    })
    const [row] = await h.sql`select date_of_birth from account where id = ${student}`
    expect(new Date(row!.date_of_birth as string).getUTCFullYear()).toBe(1900)
  })

  test('the retention flag does not leak past the transaction (a later ordinary erase is blocked)', async () => {
    const student = await makeMinor(h.sql)
    await h.sql.begin(async (tx) => {
      await tx`set local app.retention_erase = 'on'`
      await tx`update account set date_of_birth = ${DOB_TOMBSTONE} where id = ${student}`
    })
    // A fresh statement outside that transaction has no flag set; write-once holds.
    await expect(
      h.sql`update account set date_of_birth = '1901-01-01' where id = ${student}`,
    ).rejects.toThrow(/write.?once|date_of_birth|dob/i)
  })
})

describe('retention erase bypass — enrollment_record.date_of_birth', () => {
  async function seedingEnrollment(): Promise<string> {
    const chapter = await makeChapter(h.sql)
    const term = await makeTerm(h.sql, chapter)
    const issuer = await makeAdult(h.sql)
    const application = await makeApplication(h.sql, chapter, 'parent@example.test')
    const [row] = await h.sql`
      insert into enrollment_record (
        application_id, student_account_id, chapter_id, term_id, signed_form_ref,
        guardian_name_on_form, date_of_birth, created_by
      ) values (
        ${application}, ${null}, ${chapter}, ${term}, ${randomUUID()},
        'Parent Testperson', '2015-06-01', ${issuer}
      ) returning id
    `
    return row!.id as string
  }

  test('an ordinary erase of enrollment_record.date_of_birth is still blocked (write-once)', async () => {
    const enr = await seedingEnrollment()
    await expect(
      h.sql`update enrollment_record set date_of_birth = ${DOB_TOMBSTONE} where id = ${enr}`,
    ).rejects.toThrow(/write.?once|date_of_birth|dob/i)
  })

  test('an erase flagged app.retention_erase=on may tombstone the enrollment DOB', async () => {
    const enr = await seedingEnrollment()
    await h.sql.begin(async (tx) => {
      await tx`set local app.retention_erase = 'on'`
      await tx`update enrollment_record set date_of_birth = ${DOB_TOMBSTONE} where id = ${enr}`
    })
    const [row] = await h.sql`select date_of_birth from enrollment_record where id = ${enr}`
    expect(new Date(row!.date_of_birth as string).getUTCFullYear()).toBe(1900)
  })
})

describe('the retention flag and the correction flag are distinct', () => {
  test('app.dob_correction stays a valid bypass (control, unchanged by 0009)', async () => {
    const student = await makeMinor(h.sql)
    await h.sql.begin(async (tx) => {
      await tx`set local app.dob_correction = 'on'`
      await tx`update account set date_of_birth = '2016-06-01' where id = ${student}`
    })
    const [row] = await h.sql`select date_of_birth from account where id = ${student}`
    expect(new Date(row!.date_of_birth as string).getUTCFullYear()).toBe(2016)
  })
})
