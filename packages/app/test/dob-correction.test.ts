// -------------------------------------------------------------------------
// DobCorrectionService tests (the audited mistyped-scan correction; the ONLY
// sanctioned updater of the write-once DOBs). Embedded Postgres, synthetic data.
//
// 02-data-model.md "enrollment_record" / decision-log.md "DOB on the enrollment
// record, reversed and refined": both account.date_of_birth and the seeding
// enrollment_record.date_of_birth are write-once (triggers forbid ordinary
// updates). This service is gated through `authorize` under `dob.correct`
// (chapter-scoped, Chapter Director), sets the transaction-local correction flag
// the write-once triggers consult, updates both DOBs, and writes an audit entry
// carrying the reason but no DOB PII. Any update outside this service is blocked.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Forbidden, authorize, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import {
  makeAdult,
  makeApplication,
  makeChapter,
  makeEnrollment,
  makeMinor,
  makeTerm,
} from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import { DobCorrectionService, type DobCorrectionAuthorizeFn } from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

// A student whose seeding enrollment has been backfilled: the account holds the
// canonical DOB with enrollment_record provenance, and the seeding enrollment
// record (student_account_id set) still carries its write-once DOB copy.
async function backfilledStudent(dob = '2014-04-04') {
  const chapter = await makeChapter(h.sql)
  const term = await makeTerm(h.sql, chapter)
  const director = await makeAdult(h.sql)
  const sourceRef = randomUUID()
  const student = await makeMinor(h.sql, {
    dateOfBirth: dob,
    dobProvenance: 'enrollment_record',
    dobSourceRef: sourceRef,
  })
  const application = await makeApplication(h.sql, chapter, 'parent@example.test')
  const enrollmentRecordId = await makeEnrollment(h.sql, {
    applicationId: application,
    chapterId: chapter,
    termId: term,
    createdBy: director,
    studentAccountId: student, // backfilled
    dateOfBirth: dob, // the seeding DOB copy stays on the record
  })
  return { chapter, term, director, student, enrollmentRecordId, sourceRef }
}

function svc() {
  return new DobCorrectionService({ sql: h.sql, authorize })
}
function directorCtx(f: { director: string; chapter: string }) {
  return baseCtx(f.director, new Date(), [mem('chapter_director', f.chapter)])
}

async function dobText(table: 'account' | 'enrollment_record', id: string): Promise<string> {
  const [row] =
    table === 'account'
      ? await h.sql`select date_of_birth::text as d from account where id = ${id}`
      : await h.sql`select date_of_birth::text as d from enrollment_record where id = ${id}`
  return row!.d as string
}

// ===========================================================================
describe('DobCorrectionService.correct', () => {
  test('a director corrects both the account and the seeding enrollment DOB, audited, with no DOB PII in the audit detail', async () => {
    const f = await backfilledStudent('2014-04-04')
    const ctx = directorCtx(f)

    await withRequest(async () => {
      await svc().correct({ accountId: f.student }, '2013-03-03', ctx, 'mistyped scan, corrected from the original form')
    })

    expect(await dobText('account', f.student)).toBe('2013-03-03')
    expect(await dobText('enrollment_record', f.enrollmentRecordId)).toBe('2013-03-03')

    // Provenance is untouched — still enrollment_record with the source ref.
    const [acct] = await h.sql`select dob_provenance, dob_source_ref from account where id = ${f.student}`
    expect(acct!.dob_provenance).toBe('enrollment_record')
    expect(acct!.dob_source_ref).toBe(f.sourceRef)

    // Exactly one dob.correct audit entry, carrying the reason, no DOB value.
    const audits = await h.sql`
      select action, subject_type, subject_id, chapter_id, detail from audit_entry
      where action = 'dob.correct' and subject_id = ${f.student}
    `
    expect(audits).toHaveLength(1)
    expect(audits[0]!.subject_type).toBe('account')
    expect(audits[0]!.chapter_id).toBe(f.chapter)
    expect(audits[0]!.detail).toMatchObject({ reason: 'mistyped scan, corrected from the original form' })
    // No DOB value leaks into the audit detail (neither the old nor the new).
    expect(JSON.stringify(audits[0]!.detail)).not.toMatch(/2013-03-03|2014-04-04/)
  })

  test('is the ONLY path: an ordinary update of the account DOB is still blocked after a correction', async () => {
    const f = await backfilledStudent('2014-04-04')
    const ctx = directorCtx(f)
    await withRequest(async () => {
      await svc().correct({ accountId: f.student }, '2013-03-03', ctx, 'fix')
    })
    // An ordinary update (no correction flag) is rejected by the write-once trigger.
    await expect(
      h.sql`update account set date_of_birth = '2012-02-02' where id = ${f.student}`,
    ).rejects.toThrow(/write.?once|date_of_birth|dob/i)
    expect(await dobText('account', f.student)).toBe('2013-03-03')
  })

  test('a non-director in the chapter is denied: Forbidden, one permission.denied row, no change', async () => {
    const f = await backfilledStudent('2014-04-04')
    const leadId = await makeAdult(h.sql)
    const lead = baseCtx(leadId, new Date(), [mem('lead_instructor', f.chapter)])

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().correct({ accountId: f.student }, '2013-03-03', lead, 'nope')
      } catch (e) {
        caught = e
      }
    })

    expect(caught).toBeInstanceOf(Forbidden)
    expect(JSON.stringify(caught)).not.toMatch(/role_not_permitted/)
    const denied = await h.sql`
      select detail from audit_entry where action = 'permission.denied' and actor_account_id = ${leadId}
    `
    expect(denied).toHaveLength(1)
    expect(denied[0]!.detail).toMatchObject({ capability: 'dob.correct', reason: 'role_not_permitted' })
    // Nothing changed.
    expect(await dobText('account', f.student)).toBe('2014-04-04')
  })

  test('a director in another chapter is denied (out_of_scope), no change', async () => {
    const f = await backfilledStudent('2014-04-04')
    const otherChapter = await makeChapter(h.sql)
    const strangerId = await makeAdult(h.sql)
    const stranger = baseCtx(strangerId, new Date(), [mem('chapter_director', otherChapter)])

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().correct({ accountId: f.student }, '2013-03-03', stranger, 'nope')
      } catch (e) {
        caught = e
      }
    })

    expect(caught).toBeInstanceOf(Forbidden)
    const denied = await h.sql`
      select detail from audit_entry where action = 'permission.denied' and actor_account_id = ${strangerId}
    `
    expect(denied).toHaveLength(1)
    expect(denied[0]!.detail).toMatchObject({ capability: 'dob.correct', reason: 'out_of_scope' })
    expect(await dobText('account', f.student)).toBe('2014-04-04')
  })

  test('the runtime backstop holds: an authorize that allows without recording a decision cannot mutate', async () => {
    const f = await backfilledStudent('2014-04-04')
    const ctx = directorCtx(f)
    const allowWithoutRecording: DobCorrectionAuthorizeFn = async () => undefined
    const service = new DobCorrectionService({ sql: h.sql, authorize: allowWithoutRecording })

    let caught: unknown
    await withRequest(async () => {
      try {
        await service.correct({ accountId: f.student }, '2013-03-03', ctx, 'x')
      } catch (e) {
        caught = e
      }
    })

    expect((caught as Error).message).toMatch(/no authorization decision recorded/)
    expect(await dobText('account', f.student)).toBe('2014-04-04')
  })
})
