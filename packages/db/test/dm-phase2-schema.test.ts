// -------------------------------------------------------------------------
// Mentor-student direct messaging (Phase 2, migration 0031) — the structural
// constraints layer: the per-chapter closed-hours override on `chapter`, and the
// append-only `dm_flag` content-flag record (design C.4, C.5). Built DARK behind
// MENTOR_DM_ENABLED; this proves the DB MECHANISM against SYNTHETIC data.
//
// TDD: run with CURIOLAB_MIGRATE_UPTO=0030 to witness these fail (the 0031 columns
// / relation do not exist yet); the default run applies 0031 and they pass.
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

const ENVELOPE = { v: 1, iv: 'aXYtaXYtaXYtaXY=', ct: 'Y2lwaGVydGV4dA==', tag: 'dGFndGFndGFndGFndGFndGE=' }

async function makeThreadWithMessage(): Promise<{ threadId: string; messageId: string }> {
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
    values (${thread!.id}, ${mentorAcct}, ${h.sql.json(ENVELOPE)}) returning id
  `
  return { threadId: thread!.id as string, messageId: msg!.id as string }
}

// ---------------------------------------------------------------------------
describe('chapter closed-hours override (design C.4)', () => {
  test('dm_open_hour / dm_close_hour are nullable and accept a value', async () => {
    const chapter = await makeChapter()
    // Default: both null (use the config default window).
    const [before] = await h.sql`select dm_open_hour, dm_close_hour from chapter where id = ${chapter}`
    expect(before!.dm_open_hour).toBeNull()
    expect(before!.dm_close_hour).toBeNull()

    await h.sql`update chapter set dm_open_hour = 9, dm_close_hour = 18 where id = ${chapter}`
    const [after] = await h.sql`select dm_open_hour, dm_close_hour from chapter where id = ${chapter}`
    expect(Number(after!.dm_open_hour)).toBe(9)
    expect(Number(after!.dm_close_hour)).toBe(18)
  })

  test('an out-of-range hour is REFUSED by the CHECK', async () => {
    const chapter = await makeChapter()
    await expect(
      h.sql`update chapter set dm_open_hour = 24 where id = ${chapter}`,
    ).rejects.toThrow(/check|violates/i)
  })
})

// ---------------------------------------------------------------------------
describe('dm_flag shape + append-only (design C.5)', () => {
  test('a flag inserts with the {thread_id, message_id, category, detail} shape', async () => {
    const { threadId, messageId } = await makeThreadWithMessage()
    const [flag] = await h.sql`
      insert into dm_flag (thread_id, message_id, category, detail)
      values (${threadId}, ${messageId}, 'contact_info', 'email')
      returning id, category, detail
    `
    expect(flag!.id).toBeTruthy()
    expect(flag!.category).toBe('contact_info')
    expect(flag!.detail).toBe('email')
  })

  test('UPDATE + DELETE on dm_flag are rejected by the append-only trigger', async () => {
    const { threadId, messageId } = await makeThreadWithMessage()
    const [flag] = await h.sql`
      insert into dm_flag (thread_id, message_id, category, detail)
      values (${threadId}, ${messageId}, 'contact_info', 'phone') returning id
    `
    await expect(
      h.sql`update dm_flag set category = 'x' where id = ${flag!.id}`,
    ).rejects.toThrow(/append-only/i)
    await expect(
      h.sql`delete from dm_flag where id = ${flag!.id}`,
    ).rejects.toThrow(/append-only/i)
  })
})
