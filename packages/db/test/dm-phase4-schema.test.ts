// -------------------------------------------------------------------------
// Mentor-student direct messaging (Phase 4, migration 0033) — the PARTICIPANT &
// GUARDIAN SURFACES layer's two small new tables: the append-only student
// first-open onboarding acknowledgement (dm_onboarding_ack, design C.12) and the
// append-only "something feels off" student report (dm_report, design C.12).
// Built DARK behind MENTOR_DM_ENABLED; this proves the DB MECHANISM against
// SYNTHETIC data only.
//
// TDD: run with CURIOLAB_MIGRATE_UPTO=0032 to witness these fail (the 0033
// relations do not exist yet); the default run applies 0033 and they pass.
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

async function makeAdult(): Promise<string> {
  const [row] = await h.sql`
    insert into account (
      email, username, legal_name, display_name, date_of_birth,
      dob_provenance, dob_source_ref, credential_owner, status, maturation_state
    ) values (
      ${`person-${randomUUID().slice(0, 8)}@example.test`}, ${null}, 'Adult Testperson', 'Adult T.',
      '1990-01-01', 'staff_entered', ${null}, 'self_private', 'active', 'self_managed'
    ) returning id
  `
  return row!.id as string
}

async function makeMinor(): Promise<string> {
  const [row] = await h.sql`
    insert into account (
      email, username, legal_name, display_name, date_of_birth,
      dob_provenance, dob_source_ref, credential_owner, status, maturation_state
    ) values (
      ${null}, ${`student-${randomUUID().slice(0, 8)}`}, 'Minor Testchild', 'Minor T.',
      '2015-06-01', 'enrollment_record', ${randomUUID()}, 'guardian_provisioned', 'active', 'minor'
    ) returning id
  `
  return row!.id as string
}

const ENVELOPE = { v: 1, iv: 'aXYtaXYtaXYtaXY=', ct: 'Y2lwaGVydGV4dA==', tag: 'dGFndGFndGFndGFndGE=' }

async function makeThread(): Promise<{ chapter: string; student: string; threadId: string }> {
  const chapter = await makeChapter()
  const mentorAcct = await makeAdult()
  const [mem] = await h.sql`
    insert into membership (account_id, chapter_id, role, status)
    values (${mentorAcct}, ${chapter}, 'junior_mentor', 'active') returning id
  `
  const student = await makeMinor()
  const [thread] = await h.sql`
    insert into dm_thread (
      chapter_id, mentor_membership_id, student_account_id,
      visibility_header_version, visibility_header_text
    ) values (${chapter}, ${mem!.id}, ${student}, 'v1', 'saved permanently')
    returning id
  `
  await h.sql`
    insert into dm_message (thread_id, sender_account_id, body)
    values (${thread!.id}, ${mentorAcct}, ${h.sql.json(ENVELOPE)})
  `
  return { chapter, student, threadId: thread!.id as string }
}

// ---------------------------------------------------------------------------
describe('dm_onboarding_ack (design C.12)', () => {
  test('an acknowledgement inserts with {student_account_id, acknowledged_at}', async () => {
    const student = await makeMinor()
    const [row] = await h.sql`
      insert into dm_onboarding_ack (student_account_id)
      values (${student})
      returning id, student_account_id, acknowledged_at
    `
    expect(row!.id).toBeTruthy()
    expect(row!.student_account_id).toBe(student)
    expect(row!.acknowledged_at).toBeTruthy()
  })

  test('UPDATE + DELETE on dm_onboarding_ack are rejected by the append-only trigger', async () => {
    const student = await makeMinor()
    const [row] = await h.sql`
      insert into dm_onboarding_ack (student_account_id) values (${student}) returning id
    `
    await expect(
      h.sql`update dm_onboarding_ack set student_account_id = ${student} where id = ${row!.id}`,
    ).rejects.toThrow(/append-only/i)
    await expect(h.sql`delete from dm_onboarding_ack where id = ${row!.id}`).rejects.toThrow(/append-only/i)
  })
})

// ---------------------------------------------------------------------------
describe('dm_report (design C.12)', () => {
  test('a report inserts referencing a thread + reporter with an optional note', async () => {
    const { threadId, student } = await makeThread()
    const [row] = await h.sql`
      insert into dm_report (thread_id, reporter_account_id, note)
      values (${threadId}, ${student}, 'something feels off (synthetic)')
      returning id, thread_id, reporter_account_id, note, created_at
    `
    expect(row!.id).toBeTruthy()
    expect(row!.thread_id).toBe(threadId)
    expect(row!.reporter_account_id).toBe(student)
    expect(row!.note).toBe('something feels off (synthetic)')
    expect(row!.created_at).toBeTruthy()
  })

  test('the note is optional (NULL allowed)', async () => {
    const { threadId, student } = await makeThread()
    const [row] = await h.sql`
      insert into dm_report (thread_id, reporter_account_id)
      values (${threadId}, ${student}) returning id, note
    `
    expect(row!.id).toBeTruthy()
    expect(row!.note).toBeNull()
  })

  test('UPDATE + DELETE on dm_report are rejected by the append-only trigger', async () => {
    const { threadId, student } = await makeThread()
    const [row] = await h.sql`
      insert into dm_report (thread_id, reporter_account_id) values (${threadId}, ${student}) returning id
    `
    await expect(
      h.sql`update dm_report set note = 'x' where id = ${row!.id}`,
    ).rejects.toThrow(/append-only/i)
    await expect(h.sql`delete from dm_report where id = ${row!.id}`).rejects.toThrow(/append-only/i)
  })
})
