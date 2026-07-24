// -------------------------------------------------------------------------
// guardian/director portal work order, Feature 3 — guardian <-> chapter-staff
// MESSAGING, as an APPEND-ONLY log (migration 0028_messaging.sql).
//
// Threaded, append-only, retained like email. A `message_thread` (one row per
// guardian<->chapter conversation, INSERT-once, never edited) and a `message`
// (one append-only row per message, INSERT-only). NOTHING is ever updated or
// hard-deleted — both tables compose with the SAME reject_append_only_mutation()
// trigger + role REVOKE that guard the other append-only ledgers (calendar_event
// / attendance_exception / access_ledger).
//
// `last_message_at` is NOT a stored, mutated column — it is DERIVED by the
// `message_thread_current` projection view as max(sent_at) over the thread's
// messages (coalesced to the thread's created_at when it has none). So the thread
// row is truly immutable: the "advance" of last_message_at as replies append is a
// projection, never a destructive UPDATE. sender_role is a checked enum
// (guardian|mentor|director) written server-side by the service, never trusted
// from the client.
//
// The red-before-green witnesses:
//   * message_thread + message exist; the message_sender_role enum; account/thread
//     fks; body NOT NULL;
//   * message_thread_current derives last_message_at = max(sent_at) (created_at
//     when there are no messages yet);
//   * append-only (UPDATE/DELETE rejected by the trigger + role REVOKE) on BOTH;
//   * Mechanism-A grants: app SELECT/INSERT (not UPDATE/DELETE).
//
// TDD: run with CURIOLAB_MIGRATE_UPTO=0027 to witness these fail (the relations do
// not exist yet); the default run applies 0028 and they pass.
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

async function makeAccount(): Promise<string> {
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

async function makeChapter(): Promise<string> {
  const [row] = await h.sql`
    insert into chapter (name, slug, tier, status, timezone)
    values ('Test Chapter', ${'chapter-' + randomUUID()}, 'active', 'active', 'America/New_York')
    returning id
  `
  return row!.id as string
}

/** Insert a thread; returns the row. */
async function insertThread(o: {
  chapterId: string
  guardianAccountId: string
  subject?: string | null
}) {
  const [row] = await h.sql`
    insert into message_thread (chapter_id, guardian_account_id, subject)
    values (${o.chapterId}, ${o.guardianAccountId}, ${o.subject ?? null})
    returning id, chapter_id, guardian_account_id, subject, created_at
  `
  return row!
}

/** Insert a message revision row; returns the row. */
async function insertMessage(o: {
  threadId: string
  senderAccountId: string
  senderRole?: string
  body?: string
  sentAt?: string
}) {
  const [row] = await h.sql`
    insert into message (thread_id, sender_account_id, sender_role, body${
      o.sentAt ? h.sql`, sent_at` : h.sql``
    })
    values (
      ${o.threadId}, ${o.senderAccountId}, ${o.senderRole ?? 'guardian'}, ${o.body ?? 'hello'}${
        o.sentAt ? h.sql`, ${o.sentAt}` : h.sql``
      }
    )
    returning id, seq, thread_id, sender_account_id, sender_role, body, sent_at
  `
  return row!
}

// ---------------------------------------------------------------------------
describe('message_thread + message shape and enums', () => {
  test('a thread + a message insert with ids, sender_role, body, seq', async () => {
    const chapter = await makeChapter()
    const guardian = await makeAccount()
    const thread = await insertThread({ chapterId: chapter, guardianAccountId: guardian, subject: 'Pickup change' })
    expect(thread.id).toBeTruthy()
    expect(thread.subject).toBe('Pickup change')
    expect(thread.created_at).not.toBeNull()

    const msg = await insertMessage({ threadId: thread.id as string, senderAccountId: guardian, body: 'Running late' })
    expect(msg.id).toBeTruthy()
    expect(msg.seq).toBeTruthy()
    expect(msg.thread_id).toBe(thread.id)
    expect(msg.sender_role).toBe('guardian')
    expect(msg.body).toBe('Running late')
    expect(msg.sent_at).not.toBeNull()
  })

  test('subject is nullable (a bare thread)', async () => {
    const chapter = await makeChapter()
    const guardian = await makeAccount()
    const thread = await insertThread({ chapterId: chapter, guardianAccountId: guardian, subject: null })
    expect(thread.subject).toBeNull()
  })

  test('all three sender roles are accepted', async () => {
    const chapter = await makeChapter()
    const guardian = await makeAccount()
    const staff = await makeAccount()
    const thread = await insertThread({ chapterId: chapter, guardianAccountId: guardian })
    const g = await insertMessage({ threadId: thread.id as string, senderAccountId: guardian, senderRole: 'guardian' })
    const m = await insertMessage({ threadId: thread.id as string, senderAccountId: staff, senderRole: 'mentor' })
    const d = await insertMessage({ threadId: thread.id as string, senderAccountId: staff, senderRole: 'director' })
    expect([g.sender_role, m.sender_role, d.sender_role]).toEqual(['guardian', 'mentor', 'director'])
  })

  test('sender_role is a checked enum: garbage is rejected', async () => {
    const chapter = await makeChapter()
    const guardian = await makeAccount()
    const thread = await insertThread({ chapterId: chapter, guardianAccountId: guardian })
    await expect(
      insertMessage({ threadId: thread.id as string, senderAccountId: guardian, senderRole: 'admin' }),
    ).rejects.toThrow(/invalid input value for enum/i)
  })

  test('body is NOT NULL', async () => {
    const chapter = await makeChapter()
    const guardian = await makeAccount()
    const thread = await insertThread({ chapterId: chapter, guardianAccountId: guardian })
    await expect(
      h.sql`insert into message (thread_id, sender_account_id, sender_role, body)
            values (${thread.id}, ${guardian}, 'guardian', ${null})`,
    ).rejects.toThrow(/null value|not-null/i)
  })

  test('thread + sender fks are checked', async () => {
    const guardian = await makeAccount()
    // unknown thread
    await expect(
      insertMessage({ threadId: randomUUID(), senderAccountId: guardian }),
    ).rejects.toThrow(/foreign key|violates/i)
    // unknown sender
    const chapter = await makeChapter()
    const thread = await insertThread({ chapterId: chapter, guardianAccountId: guardian })
    await expect(
      insertMessage({ threadId: thread.id as string, senderAccountId: randomUUID() }),
    ).rejects.toThrow(/foreign key|violates/i)
  })
})

// ---------------------------------------------------------------------------
describe('message_thread_current projection (derived last_message_at)', () => {
  test('last_message_at is max(sent_at); created_at when the thread has no messages', async () => {
    const chapter = await makeChapter()
    const guardian = await makeAccount()
    const thread = await insertThread({ chapterId: chapter, guardianAccountId: guardian })

    // No messages yet -> last_message_at = created_at.
    const [empty] = await h.sql`
      select created_at, last_message_at from message_thread_current where id = ${thread.id}
    `
    expect(new Date(empty!.last_message_at as string).getTime()).toBe(
      new Date(empty!.created_at as string).getTime(),
    )

    // Append two messages; last_message_at advances to the latest sent_at.
    await insertMessage({ threadId: thread.id as string, senderAccountId: guardian, sentAt: '2099-03-01T10:00:00Z' })
    await insertMessage({ threadId: thread.id as string, senderAccountId: guardian, sentAt: '2099-03-05T12:00:00Z' })
    const [cur] = await h.sql`
      select last_message_at from message_thread_current where id = ${thread.id}
    `
    expect(new Date(cur!.last_message_at as string).getTime()).toBe(
      new Date('2099-03-05T12:00:00Z').getTime(),
    )
  })
})

// ---------------------------------------------------------------------------
describe('append-only enforcement on message_thread + message', () => {
  test('UPDATE + DELETE on message are rejected by the trigger', async () => {
    const chapter = await makeChapter()
    const guardian = await makeAccount()
    const thread = await insertThread({ chapterId: chapter, guardianAccountId: guardian })
    const msg = await insertMessage({ threadId: thread.id as string, senderAccountId: guardian })
    await expect(
      h.sql`update message set body = 'edited' where id = ${msg.id}`,
    ).rejects.toThrow(/append-only/i)
    await expect(
      h.sql`delete from message where id = ${msg.id}`,
    ).rejects.toThrow(/append-only/i)
  })

  test('UPDATE + DELETE on message_thread are rejected by the trigger', async () => {
    const chapter = await makeChapter()
    const guardian = await makeAccount()
    const thread = await insertThread({ chapterId: chapter, guardianAccountId: guardian })
    await expect(
      h.sql`update message_thread set subject = 'edited' where id = ${thread.id}`,
    ).rejects.toThrow(/append-only/i)
    await expect(
      h.sql`delete from message_thread where id = ${thread.id}`,
    ).rejects.toThrow(/append-only/i)
  })
})

// ---------------------------------------------------------------------------
describe('Mechanism A: grants on message_thread + message', () => {
  test('app may SELECT/INSERT but not UPDATE/DELETE', async () => {
    const chapter = await makeChapter()
    const guardian = await makeAccount()
    const app = h.connectAs('curiolab_app', 'app_pw')
    const threadRows = await app`
      insert into message_thread (chapter_id, guardian_account_id, subject)
      values (${chapter}, ${guardian}, 'Hi') returning id
    `
    expect(threadRows.length).toBe(1)
    const threadId = threadRows[0]!.id as string
    const msgRows = await app`
      insert into message (thread_id, sender_account_id, sender_role, body)
      values (${threadId}, ${guardian}, 'guardian', 'hello') returning id
    `
    expect(msgRows.length).toBe(1)
    const read = await app`select id from message where id = ${msgRows[0]!.id}`
    expect(read.length).toBe(1)
    await expect(
      app`update message set body = 'x' where id = ${msgRows[0]!.id}`,
    ).rejects.toThrow(/permission denied|append-only/i)
    await expect(
      app`delete from message where id = ${msgRows[0]!.id}`,
    ).rejects.toThrow(/permission denied|append-only/i)
    await expect(
      app`update message_thread set subject = 'x' where id = ${threadId}`,
    ).rejects.toThrow(/permission denied|append-only/i)
    await expect(
      app`delete from message_thread where id = ${threadId}`,
    ).rejects.toThrow(/permission denied|append-only/i)
  })
})
