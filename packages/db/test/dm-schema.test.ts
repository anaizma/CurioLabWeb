// -------------------------------------------------------------------------
// Mentor-student direct messaging (Phase 1, migrations 0029 + 0030) — the
// append-only ENCRYPTED four-party thread store + the safety-officer not-a-peer
// floor + the mentor_dm signed-form floor + the Part D enable-precondition tables.
// Built DARK behind MENTOR_DM_ENABLED; this proves the DB MECHANISM against
// SYNTHETIC data. The relations exist, encryption at rest is enforced, append-only
// holds, and the two DB floors refuse the forbidden shapes.
//
// TDD: run with CURIOLAB_MIGRATE_UPTO=0029 to witness these fail (the 0030
// relations do not exist yet); the default run applies 0030 and they pass.
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

async function makeMembership(o: {
  accountId: string
  chapterId: string
  role: string
  status?: string
}): Promise<string> {
  const [row] = await h.sql`
    insert into membership (account_id, chapter_id, role, status)
    values (${o.accountId}, ${o.chapterId}, ${o.role}, ${o.status ?? 'active'})
    returning id
  `
  return row!.id as string
}

// A synthetic AES-256-GCM {v,iv,ct,tag} envelope shape (values are placeholder
// base64; the DB CHECK asserts the KEYS, the app asserts the crypto).
const ENVELOPE = { v: 1, iv: 'aXYtaXYtaXYtaXY=', ct: 'Y2lwaGVydGV4dA==', tag: 'dGFndGFndGFndGFndGFndGE=' }

async function insertThread(o: {
  chapterId: string
  mentorMembershipId: string
  studentAccountId: string
}) {
  const [row] = await h.sql`
    insert into dm_thread (
      chapter_id, mentor_membership_id, student_account_id,
      visibility_header_version, visibility_header_text
    ) values (
      ${o.chapterId}, ${o.mentorMembershipId}, ${o.studentAccountId},
      'v1', 'This conversation is saved permanently and read by the safety officer and your guardian.'
    ) returning id, created_at
  `
  return row!
}

// ---------------------------------------------------------------------------
describe('dm_thread + dm_message shape and encryption at rest', () => {
  test('a thread + an encrypted message insert', async () => {
    const chapter = await makeChapter()
    const mentorAcct = await makeAdult()
    const mentorMem = await makeMembership({ accountId: mentorAcct, chapterId: chapter, role: 'junior_mentor' })
    const student = await makeMinor()
    const thread = await insertThread({ chapterId: chapter, mentorMembershipId: mentorMem, studentAccountId: student })
    expect(thread.id).toBeTruthy()

    const [msg] = await h.sql`
      insert into dm_message (thread_id, sender_account_id, body)
      values (${thread.id}, ${mentorAcct}, ${h.sql.json(ENVELOPE)})
      returning id, seq, body
    `
    expect(msg!.id).toBeTruthy()
    expect(msg!.seq).toBeTruthy()
    // The stored body is the envelope, not plaintext.
    expect(msg!.body).toMatchObject({ v: 1, ct: ENVELOPE.ct })
  })

  test('a plaintext (non-envelope) body is REFUSED by the encryption CHECK', async () => {
    const chapter = await makeChapter()
    const mentorAcct = await makeAdult()
    const mentorMem = await makeMembership({ accountId: mentorAcct, chapterId: chapter, role: 'junior_mentor' })
    const student = await makeMinor()
    const thread = await insertThread({ chapterId: chapter, mentorMembershipId: mentorMem, studentAccountId: student })
    await expect(
      h.sql`insert into dm_message (thread_id, sender_account_id, body)
            values (${thread.id}, ${mentorAcct}, ${h.sql.json({ text: 'hello in the clear' })})`,
    ).rejects.toThrow(/check|violates/i)
  })

  test('one thread per (mentor, student) pair (unique)', async () => {
    const chapter = await makeChapter()
    const mentorAcct = await makeAdult()
    const mentorMem = await makeMembership({ accountId: mentorAcct, chapterId: chapter, role: 'junior_mentor' })
    const student = await makeMinor()
    await insertThread({ chapterId: chapter, mentorMembershipId: mentorMem, studentAccountId: student })
    await expect(
      insertThread({ chapterId: chapter, mentorMembershipId: mentorMem, studentAccountId: student }),
    ).rejects.toThrow(/unique|duplicate/i)
  })
})

// ---------------------------------------------------------------------------
describe('dm_thread_current projection (derived last_message_at)', () => {
  test('last_message_at is max(sent_at); created_at when the thread has no messages', async () => {
    const chapter = await makeChapter()
    const mentorAcct = await makeAdult()
    const mentorMem = await makeMembership({ accountId: mentorAcct, chapterId: chapter, role: 'junior_mentor' })
    const student = await makeMinor()
    const thread = await insertThread({ chapterId: chapter, mentorMembershipId: mentorMem, studentAccountId: student })

    const [empty] = await h.sql`select created_at, last_message_at, message_count from dm_thread_current where id = ${thread.id}`
    expect(new Date(empty!.last_message_at as string).getTime()).toBe(new Date(empty!.created_at as string).getTime())
    expect(Number(empty!.message_count)).toBe(0)

    await h.sql`insert into dm_message (thread_id, sender_account_id, body, sent_at)
                values (${thread.id}, ${mentorAcct}, ${h.sql.json(ENVELOPE)}, '2099-03-01T10:00:00Z')`
    await h.sql`insert into dm_message (thread_id, sender_account_id, body, sent_at)
                values (${thread.id}, ${mentorAcct}, ${h.sql.json(ENVELOPE)}, '2099-03-05T12:00:00Z')`
    const [cur] = await h.sql`select last_message_at, message_count from dm_thread_current where id = ${thread.id}`
    expect(new Date(cur!.last_message_at as string).getTime()).toBe(new Date('2099-03-05T12:00:00Z').getTime())
    expect(Number(cur!.message_count)).toBe(2)
  })
})

// ---------------------------------------------------------------------------
describe('append-only enforcement on dm_thread + dm_message', () => {
  test('UPDATE + DELETE on dm_message are rejected by the trigger', async () => {
    const chapter = await makeChapter()
    const mentorAcct = await makeAdult()
    const mentorMem = await makeMembership({ accountId: mentorAcct, chapterId: chapter, role: 'junior_mentor' })
    const student = await makeMinor()
    const thread = await insertThread({ chapterId: chapter, mentorMembershipId: mentorMem, studentAccountId: student })
    const [msg] = await h.sql`insert into dm_message (thread_id, sender_account_id, body)
                              values (${thread.id}, ${mentorAcct}, ${h.sql.json(ENVELOPE)}) returning id`
    await expect(h.sql`update dm_message set body = ${h.sql.json(ENVELOPE)} where id = ${msg!.id}`).rejects.toThrow(/append-only/i)
    await expect(h.sql`delete from dm_message where id = ${msg!.id}`).rejects.toThrow(/append-only/i)
  })

  test('UPDATE + DELETE on dm_thread are rejected by the trigger', async () => {
    const chapter = await makeChapter()
    const mentorAcct = await makeAdult()
    const mentorMem = await makeMembership({ accountId: mentorAcct, chapterId: chapter, role: 'junior_mentor' })
    const student = await makeMinor()
    const thread = await insertThread({ chapterId: chapter, mentorMembershipId: mentorMem, studentAccountId: student })
    await expect(h.sql`update dm_thread set visibility_header_text = 'x' where id = ${thread.id}`).rejects.toThrow(/append-only/i)
    await expect(h.sql`delete from dm_thread where id = ${thread.id}`).rejects.toThrow(/append-only/i)
  })
})

// ---------------------------------------------------------------------------
describe('mentor_dm signed-form DB floor (design C.3)', () => {
  test('a click method for a mentor_dm grant is REFUSED', async () => {
    const student = await makeMinor()
    const guardian = await makeAdult()
    await expect(
      h.sql`insert into consent_grant (grant_type, subject_student_account_id, guardian_account_id, method, evidence_artifact_ref)
            values ('mentor_dm', ${student}, ${guardian}, 'click', ${'artifact-ref'})`,
    ).rejects.toThrow(/signed_form/i)
  })

  test('a signed_form with no evidence artifact is REFUSED', async () => {
    const student = await makeMinor()
    const guardian = await makeAdult()
    await expect(
      h.sql`insert into consent_grant (grant_type, subject_student_account_id, guardian_account_id, method, evidence_artifact_ref)
            values ('mentor_dm', ${student}, ${guardian}, 'signed_form', ${null})`,
    ).rejects.toThrow(/evidence_artifact_ref/i)
  })

  test('a signed_form WITH an artifact is accepted', async () => {
    const student = await makeMinor()
    const guardian = await makeAdult()
    const [row] = await h.sql`
      insert into consent_grant (grant_type, subject_student_account_id, guardian_account_id, method, evidence_artifact_ref)
      values ('mentor_dm', ${student}, ${guardian}, 'signed_form', ${'signed-form-ref-123'})
      returning id
    `
    expect(row!.id).toBeTruthy()
  })

  test('a mentor_dm REVOCATION row (revoked_at set, click method) is EXEMPT', async () => {
    const student = await makeMinor()
    const guardian = await makeAdult()
    const [row] = await h.sql`
      insert into consent_grant (grant_type, subject_student_account_id, guardian_account_id, method, revoked_at, revoked_by)
      values ('mentor_dm', ${student}, ${guardian}, 'click', now(), ${guardian})
      returning id
    `
    expect(row!.id).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
describe('safety_officer not-a-peer DB floor (design C.1)', () => {
  test('a safety_officer cannot be added where the account is already a mentor in that chapter', async () => {
    const chapter = await makeChapter()
    const acct = await makeAdult()
    await makeMembership({ accountId: acct, chapterId: chapter, role: 'junior_mentor' })
    await expect(
      makeMembership({ accountId: acct, chapterId: chapter, role: 'safety_officer' }),
    ).rejects.toThrow(/safety_officer|same chapter/i)
  })

  test('a mentor cannot be added where the account is already the safety_officer in that chapter', async () => {
    const chapter = await makeChapter()
    const acct = await makeAdult()
    await makeMembership({ accountId: acct, chapterId: chapter, role: 'safety_officer' })
    await expect(
      makeMembership({ accountId: acct, chapterId: chapter, role: 'junior_mentor' }),
    ).rejects.toThrow(/safety_officer|same chapter/i)
  })

  test('a non-peer safety_officer assignment succeeds (fresh account)', async () => {
    const chapter = await makeChapter()
    const acct = await makeAdult()
    const id = await makeMembership({ accountId: acct, chapterId: chapter, role: 'safety_officer' })
    expect(id).toBeTruthy()
  })

  test('the same account may be safety_officer in one chapter and a mentor in ANOTHER', async () => {
    const c1 = await makeChapter()
    const c2 = await makeChapter()
    const acct = await makeAdult()
    await makeMembership({ accountId: acct, chapterId: c1, role: 'safety_officer' })
    const id = await makeMembership({ accountId: acct, chapterId: c2, role: 'junior_mentor' })
    expect(id).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
describe('Part D enable-precondition tables + Mechanism A grants', () => {
  test('dm_insurance_attestation + dm_chapter_switch exist and are append-only', async () => {
    const chapter = await makeChapter()
    const director = await makeAdult()
    const [att] = await h.sql`insert into dm_insurance_attestation (chapter_id, carrier, policy_ref, attested_by)
                              values (${chapter}, 'Synthetic Mutual', 'POL-123', ${director}) returning id`
    expect(att!.id).toBeTruthy()
    await expect(h.sql`delete from dm_insurance_attestation where id = ${att!.id}`).rejects.toThrow(/append-only/i)

    const [sw] = await h.sql`insert into dm_chapter_switch (chapter_id, enabled_by)
                             values (${chapter}, ${director}) returning id`
    expect(sw!.id).toBeTruthy()
    await expect(h.sql`update dm_chapter_switch set enabled_by = ${director} where id = ${sw!.id}`).rejects.toThrow(/append-only/i)
    // one switch row per chapter
    await expect(h.sql`insert into dm_chapter_switch (chapter_id, enabled_by) values (${chapter}, ${director})`)
      .rejects.toThrow(/unique|duplicate/i)
  })

  test('app may SELECT/INSERT dm_thread + dm_message but not UPDATE/DELETE', async () => {
    const chapter = await makeChapter()
    const mentorAcct = await makeAdult()
    const mentorMem = await makeMembership({ accountId: mentorAcct, chapterId: chapter, role: 'junior_mentor' })
    const student = await makeMinor()
    const app = h.connectAs('curiolab_app', 'app_pw')
    const threadRows = await app`
      insert into dm_thread (chapter_id, mentor_membership_id, student_account_id, visibility_header_version, visibility_header_text)
      values (${chapter}, ${mentorMem}, ${student}, 'v1', 'header') returning id`
    const threadId = threadRows[0]!.id as string
    const msgRows = await app`insert into dm_message (thread_id, sender_account_id, body)
                              values (${threadId}, ${mentorAcct}, ${app.json(ENVELOPE)}) returning id`
    expect(msgRows.length).toBe(1)
    await expect(app`update dm_message set body = ${app.json(ENVELOPE)} where id = ${msgRows[0]!.id}`)
      .rejects.toThrow(/permission denied|append-only/i)
    await expect(app`delete from dm_thread where id = ${threadId}`).rejects.toThrow(/permission denied|append-only/i)
  })
})
