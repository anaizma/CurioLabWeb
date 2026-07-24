// -------------------------------------------------------------------------
// admin/director backend §8 — the append-only invitation/access ledger, at the
// service layer (embedded Postgres, synthetic data only).
//
// Covers the origination/access chain the ledger records: issuing an invite
// writes a row (issuer + target + kind + chapter); redemption appends a row with
// the accepting account + client IP; membership activation appends; and the
// ledger is append-only (the DB guarantee is in packages/db; here we assert the
// SERVICES write the rows). Accept-student's consent-artifact row and the
// mentor-assisted reset row are asserted in invite / recovery tests respectively.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { authorize, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMinor } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import { InviteService } from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

async function guardianSetup(guardianEmail = `parent-${randomUUID().slice(0, 8)}@example.test`) {
  const chapter = await makeChapter(h.sql)
  const [term] = await h.sql`
    insert into term (chapter_id, name, starts_on, ends_on)
    values (${chapter}, 'Fall Term 2099', '2099-09-01', '2099-12-15') returning id
  `
  const director = await makeAdult(h.sql)
  const student = await makeMinor(h.sql)
  const [app] = await h.sql`
    insert into application (
      kind, chapter_id, status, applicant_name, applicant_contact_email, guardian_name, guardian_email
    ) values (
      'student', ${chapter}, 'accepted', 'Minor Testchild', ${guardianEmail}, 'Parent Testperson', ${guardianEmail}
    ) returning id
  `
  const [enr] = await h.sql`
    insert into enrollment_record (
      application_id, student_account_id, chapter_id, term_id, signed_form_ref, guardian_name_on_form, created_by
    ) values (
      ${app!.id}, ${student}, ${chapter}, ${term!.id}, ${randomUUID()}, 'Parent Testperson', ${director}
    ) returning id
  `
  return { chapter, director, student, enrollmentRecordId: enr!.id as string, guardianEmail }
}

function svc() {
  return new InviteService({ sql: h.sql, authorize })
}

describe('issueInvite writes an invite.issued ledger row', () => {
  test('records the issuer, target email, kind, and chapter', async () => {
    const f = await guardianSetup()
    const ctx = baseCtx(f.director, new Date(), [mem('chapter_director', f.chapter)])
    let inviteId!: string
    await withRequest(async () => {
      const out = await svc().issueInvite(
        { kind: 'guardian', chapterId: f.chapter, targetEmail: f.guardianEmail, enrollmentRecordId: f.enrollmentRecordId },
        ctx,
      )
      inviteId = out.inviteId
    })

    const rows = await h.sql`
      select * from access_ledger where event = 'invite.issued' and invite_id = ${inviteId}
    `
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.actor_account_id).toBe(f.director)
    expect(row.target_email).toBe(f.guardianEmail)
    expect(row.invite_kind).toBe('guardian')
    expect(row.chapter_id).toBe(f.chapter)
    expect(row.subject_account_id).toBe(f.student)
  })
})
