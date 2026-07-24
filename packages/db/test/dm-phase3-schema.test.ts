// -------------------------------------------------------------------------
// Mentor-student direct messaging (Phase 3, migration 0032) — the DETECTION &
// OVERSIGHT layer schema: the append-only read-receipt, the flag-review record,
// the two-adult guardian-visibility suspension (event-sourced, append-only), and
// the mentor-departure thread-freeze record (design C.6, C.7, C.8, C.15). Built
// DARK behind MENTOR_DM_ENABLED; this proves the DB MECHANISM against SYNTHETIC
// data only.
//
// TDD: run with CURIOLAB_MIGRATE_UPTO=0031 to witness these fail (the 0032
// relations do not exist yet); the default run applies 0032 and they pass.
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

interface Th {
  chapter: string
  mentorAcct: string
  mentorMembership: string
  student: string
  threadId: string
  messageId: string
}

async function makeThreadWithMessage(): Promise<Th> {
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
  const [msg] = await h.sql`
    insert into dm_message (thread_id, sender_account_id, body)
    values (${thread!.id}, ${mentorAcct}, ${h.sql.json(ENVELOPE)}) returning id, seq
  `
  return {
    chapter,
    mentorAcct,
    mentorMembership: mem!.id as string,
    student,
    threadId: thread!.id as string,
    messageId: msg!.id as string,
  }
}

// ---------------------------------------------------------------------------
describe('dm_read_receipt (design C.6)', () => {
  test('a receipt inserts with {thread_id, reader_account_id, up_to_seq, read_at}', async () => {
    const t = await makeThreadWithMessage()
    const reader = await makeAdult()
    const [r] = await h.sql`
      insert into dm_read_receipt (thread_id, reader_account_id, up_to_seq)
      values (${t.threadId}, ${reader}, 5)
      returning id, up_to_seq, read_at
    `
    expect(r!.id).toBeTruthy()
    expect(Number(r!.up_to_seq)).toBe(5)
    expect(r!.read_at).toBeTruthy()
  })

  test('UPDATE + DELETE on dm_read_receipt are rejected by the append-only trigger', async () => {
    const t = await makeThreadWithMessage()
    const reader = await makeAdult()
    const [r] = await h.sql`
      insert into dm_read_receipt (thread_id, reader_account_id, up_to_seq)
      values (${t.threadId}, ${reader}, 1) returning id
    `
    await expect(h.sql`update dm_read_receipt set up_to_seq = 9 where id = ${r!.id}`).rejects.toThrow(/append-only/i)
    await expect(h.sql`delete from dm_read_receipt where id = ${r!.id}`).rejects.toThrow(/append-only/i)
  })
})

// ---------------------------------------------------------------------------
describe('dm_flag_review (design C.7)', () => {
  test('a review inserts referencing a flag with a disposition', async () => {
    const t = await makeThreadWithMessage()
    const [flag] = await h.sql`
      insert into dm_flag (thread_id, message_id, category, detail)
      values (${t.threadId}, ${t.messageId}, 'secrecy_framing', 'secrecy_framing') returning id
    `
    const reviewer = await makeAdult()
    const [rv] = await h.sql`
      insert into dm_flag_review (flag_id, reviewed_by, disposition, note)
      values (${flag!.id}, ${reviewer}, 'benign', 'synthetic review note')
      returning id, disposition
    `
    expect(rv!.id).toBeTruthy()
    expect(rv!.disposition).toBe('benign')
  })

  test('UPDATE + DELETE on dm_flag_review are rejected by the append-only trigger', async () => {
    const t = await makeThreadWithMessage()
    const [flag] = await h.sql`
      insert into dm_flag (thread_id, message_id, category, detail)
      values (${t.threadId}, ${t.messageId}, 'contact_info', 'phone') returning id
    `
    const reviewer = await makeAdult()
    const [rv] = await h.sql`
      insert into dm_flag_review (flag_id, reviewed_by, disposition)
      values (${flag!.id}, ${reviewer}, 'escalated') returning id
    `
    await expect(h.sql`update dm_flag_review set disposition = 'x' where id = ${rv!.id}`).rejects.toThrow(/append-only/i)
    await expect(h.sql`delete from dm_flag_review where id = ${rv!.id}`).rejects.toThrow(/append-only/i)
  })
})

// ---------------------------------------------------------------------------
describe('dm_visibility_suspension (design C.8, append-only event-sourced)', () => {
  test('an initiation row requires a reason (CHECK refuses a null reason on an initiated row)', async () => {
    const t = await makeThreadWithMessage()
    const officer = await makeAdult()
    // A valid initiation row.
    const suspId = randomUUID()
    const [row] = await h.sql`
      insert into dm_visibility_suspension (
        id, event, suspension_id, student_account_id, thread_id,
        initiated_by_safety_officer_id, reason, expires_at, reporter_checkpoint_ack, actor_account_id
      ) values (
        ${suspId}, 'initiated', ${suspId}, ${t.student}, ${null},
        ${officer}, 'synthetic recorded reason', now() + interval '90 days', true, ${officer}
      ) returning id
    `
    expect(row!.id).toBeTruthy()

    // A null reason on an initiated row is refused by the CHECK.
    const bad = randomUUID()
    await expect(
      h.sql`
        insert into dm_visibility_suspension (
          id, event, suspension_id, student_account_id,
          initiated_by_safety_officer_id, reason, expires_at, actor_account_id
        ) values (
          ${bad}, 'initiated', ${bad}, ${t.student},
          ${officer}, ${null}, now() + interval '90 days', ${officer}
        )
      `,
    ).rejects.toThrow(/check|violates|reason/i)
  })

  test('an acknowledgement + revocation are separate append-only event rows', async () => {
    const t = await makeThreadWithMessage()
    const officer = await makeAdult()
    const second = await makeAdult()
    const suspId = randomUUID()
    await h.sql`
      insert into dm_visibility_suspension (
        id, event, suspension_id, student_account_id,
        initiated_by_safety_officer_id, reason, expires_at, reporter_checkpoint_ack, actor_account_id
      ) values (
        ${suspId}, 'initiated', ${suspId}, ${t.student},
        ${officer}, 'reason', now() + interval '90 days', true, ${officer}
      )
    `
    const [ack] = await h.sql`
      insert into dm_visibility_suspension (
        event, suspension_id, student_account_id, second_adult_account_id, actor_account_id
      ) values ('acknowledged', ${suspId}, ${t.student}, ${second}, ${second}) returning id
    `
    expect(ack!.id).toBeTruthy()
    const [rev] = await h.sql`
      insert into dm_visibility_suspension (
        event, suspension_id, student_account_id, actor_account_id
      ) values ('revoked', ${suspId}, ${t.student}, ${officer}) returning id
    `
    expect(rev!.id).toBeTruthy()
  })

  test('UPDATE + DELETE on dm_visibility_suspension are rejected by the append-only trigger', async () => {
    const t = await makeThreadWithMessage()
    const officer = await makeAdult()
    const suspId = randomUUID()
    const [row] = await h.sql`
      insert into dm_visibility_suspension (
        id, event, suspension_id, student_account_id,
        initiated_by_safety_officer_id, reason, expires_at, actor_account_id
      ) values (
        ${suspId}, 'initiated', ${suspId}, ${t.student},
        ${officer}, 'reason', now() + interval '90 days', ${officer}
      ) returning id
    `
    await expect(
      h.sql`update dm_visibility_suspension set reason = 'x' where id = ${row!.id}`,
    ).rejects.toThrow(/append-only/i)
    await expect(
      h.sql`delete from dm_visibility_suspension where id = ${row!.id}`,
    ).rejects.toThrow(/append-only/i)
  })
})

// ---------------------------------------------------------------------------
describe('dm_thread_freeze (design C.15)', () => {
  test('a freeze row inserts with a handoff decision and is unique per thread', async () => {
    const t = await makeThreadWithMessage()
    const [f] = await h.sql`
      insert into dm_thread_freeze (thread_id, mentor_membership_id, reason, handoff_decision, frozen_by_account_id)
      values (${t.threadId}, ${t.mentorMembership}, 'mentor departed', 'successor_mentor', ${null})
      returning id, handoff_decision
    `
    expect(f!.id).toBeTruthy()
    expect(f!.handoff_decision).toBe('successor_mentor')

    // one freeze per thread
    await expect(
      h.sql`
        insert into dm_thread_freeze (thread_id, mentor_membership_id, handoff_decision)
        values (${t.threadId}, ${t.mentorMembership}, 'paused')
      `,
    ).rejects.toThrow(/unique|duplicate/i)
  })

  test('handoff_decision is required (NOT NULL)', async () => {
    const t = await makeThreadWithMessage()
    await expect(
      h.sql`
        insert into dm_thread_freeze (thread_id, mentor_membership_id)
        values (${t.threadId}, ${t.mentorMembership})
      `,
    ).rejects.toThrow(/not.null|null value/i)
  })

  test('UPDATE + DELETE on dm_thread_freeze are rejected by the append-only trigger', async () => {
    const t = await makeThreadWithMessage()
    const [f] = await h.sql`
      insert into dm_thread_freeze (thread_id, mentor_membership_id, handoff_decision)
      values (${t.threadId}, ${t.mentorMembership}, 'paused') returning id
    `
    await expect(
      h.sql`update dm_thread_freeze set handoff_decision = 'x' where id = ${f!.id}`,
    ).rejects.toThrow(/append-only/i)
    await expect(h.sql`delete from dm_thread_freeze where id = ${f!.id}`).rejects.toThrow(/append-only/i)
  })
})
