// -------------------------------------------------------------------------
// MessagingService tests (guardian/director portal work order, Feature 3) — the
// guardian <-> chapter-staff threaded, append-only messaging. Embedded Postgres,
// synthetic data only.
//
// Under test:
//   - a guardian creates a NEW thread (a message appended, sender_role='guardian');
//     the thread's chapter is resolved from the guardian's verified child;
//   - a guardian APPENDS to their own existing thread;
//   - a guardian cannot post to ANOTHER guardian's thread (Forbidden);
//   - a guardian cannot open a thread in a chapter they have NO child in (Forbidden);
//   - a multi-chapter guardian must disambiguate (ambiguous -> validation error;
//     childAccountId resolves the chapter);
//   - sender_role is DERIVED server-side (a client-supplied role in the body is
//     ignored -> always 'guardian' for a guardian send);
//   - staff of the chapter list the chapter's threads, read one thread, and reply
//     (sender_role = director or mentor per membership); a non-staff caller ->
//     Forbidden; a staff member of ANOTHER chapter cannot see or reply (no leak);
//   - append-only: last_message_at advances forward as replies append; the thread +
//     all messages persist;
//   - every send + reply writes an audit + access-ledger row.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Forbidden, authorize, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMinor, makeMembership } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import {
  MessagingService,
  MessageThreadNotFoundError,
  MessagingValidationError,
  type MessagingAuthorizeFn,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

function svc(authorizeFn = authorize as unknown as MessagingAuthorizeFn) {
  return new MessagingService({ sql: h.sql, authorize: authorizeFn })
}

const NOW = new Date('2025-01-01T00:00:00.000Z')

function guardianCtx(guardian: string, children: string[]) {
  return { ...baseCtx(guardian, NOW, []), guardianOf: children }
}
function directorCtx(director: string, chapter: string) {
  return baseCtx(director, NOW, [mem('chapter_director', chapter)])
}
function mentorCtx(mentor: string, chapter: string) {
  return baseCtx(mentor, NOW, [mem('junior_mentor', chapter)])
}

/** A verified-and-enrolled minor child with an active student membership in chapter. */
async function seedChild(chapter: string): Promise<string> {
  const child = await makeMinor(h.sql, { dateOfBirth: '2015-06-01' })
  await makeMembership(h.sql, child, chapter, { role: 'student', status: 'active' })
  return child
}

async function guardianSend(
  guardian: string,
  children: string[],
  input: { threadId?: string; subject?: string | null; body: string; childAccountId?: string; chapterId?: string },
) {
  const ctx = guardianCtx(guardian, children)
  let result!: Awaited<ReturnType<MessagingService['sendGuardianMessage']>>
  await withRequest(async () => {
    result = await svc().sendGuardianMessage(input, ctx)
  })
  return result
}

// ===========================================================================
describe('MessagingService.sendGuardianMessage — create + append', () => {
  test('a guardian creates a new thread; the first message lands sender_role=guardian in the child’s chapter', async () => {
    const chapter = await makeChapter(h.sql)
    const child = await seedChild(chapter)
    const guardian = await makeAdult(h.sql)

    const msg = await guardianSend(guardian, [child], { subject: 'Pickup change', body: 'Running 10 min late' })
    expect(msg).toMatchObject({
      senderAccountId: guardian,
      senderRole: 'guardian',
      body: 'Running 10 min late',
    })
    expect(msg.id).toBeTruthy()
    expect(msg.threadId).toBeTruthy()

    const [thread] = await h.sql`select chapter_id, guardian_account_id, subject from message_thread where id = ${msg.threadId}`
    expect(thread!.chapter_id).toBe(chapter)
    expect(thread!.guardian_account_id).toBe(guardian)
    expect(thread!.subject).toBe('Pickup change')
  })

  test('a guardian appends to their own existing thread (same thread id, second message)', async () => {
    const chapter = await makeChapter(h.sql)
    const child = await seedChild(chapter)
    const guardian = await makeAdult(h.sql)

    const first = await guardianSend(guardian, [child], { body: 'First' })
    const second = await guardianSend(guardian, [child], { threadId: first.threadId, body: 'Second' })
    expect(second.threadId).toBe(first.threadId)
    expect(second.body).toBe('Second')

    const rows = await h.sql`select body from message where thread_id = ${first.threadId} order by seq`
    expect(rows.map((r) => r.body)).toEqual(['First', 'Second'])
  })

  test('an empty body is rejected', async () => {
    const chapter = await makeChapter(h.sql)
    const child = await seedChild(chapter)
    const guardian = await makeAdult(h.sql)
    await withRequest(async () => {
      await expect(
        svc().sendGuardianMessage({ body: '   ' }, guardianCtx(guardian, [child])),
      ).rejects.toThrow(MessagingValidationError)
    })
  })

  test('sender_role is derived server-side: a client-supplied role in the body is ignored', async () => {
    const chapter = await makeChapter(h.sql)
    const child = await seedChild(chapter)
    const guardian = await makeAdult(h.sql)
    // Force a bogus senderRole onto the input; the service must ignore it.
    const msg = await guardianSend(guardian, [child], {
      body: 'hi',
      // @ts-expect-error — senderRole is not part of the input; a client cannot set it.
      senderRole: 'director',
    })
    expect(msg.senderRole).toBe('guardian')
  })
})

// ===========================================================================
describe('MessagingService.sendGuardianMessage — scope + disambiguation', () => {
  test('a guardian cannot post to ANOTHER guardian’s thread (Forbidden); no message written', async () => {
    const chapter = await makeChapter(h.sql)
    const childA = await seedChild(chapter)
    const childB = await seedChild(chapter)
    const guardianA = await makeAdult(h.sql)
    const guardianB = await makeAdult(h.sql)
    const aThread = await guardianSend(guardianA, [childA], { body: 'mine' })

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().sendGuardianMessage({ threadId: aThread.threadId, body: 'intrude' }, guardianCtx(guardianB, [childB]))
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
    const rows = await h.sql`select body from message where thread_id = ${aThread.threadId}`
    expect(rows).toHaveLength(1)
  })

  test('a guardian cannot open a thread in a chapter they have no child in (Forbidden)', async () => {
    const chapterWithChild = await makeChapter(h.sql)
    const otherChapter = await makeChapter(h.sql)
    const child = await seedChild(chapterWithChild)
    const guardian = await makeAdult(h.sql)

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().sendGuardianMessage({ chapterId: otherChapter, body: 'hello' }, guardianCtx(guardian, [child]))
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
  })

  test('a multi-chapter guardian must disambiguate; childAccountId picks the chapter', async () => {
    const chapterA = await makeChapter(h.sql)
    const chapterB = await makeChapter(h.sql)
    const childA = await seedChild(chapterA)
    const childB = await seedChild(chapterB)
    const guardian = await makeAdult(h.sql)

    // No disambiguator with children in two chapters -> ambiguous.
    await withRequest(async () => {
      await expect(
        svc().sendGuardianMessage({ body: 'which?' }, guardianCtx(guardian, [childA, childB])),
      ).rejects.toThrow(MessagingValidationError)
    })

    // childAccountId resolves the chapter.
    const msg = await guardianSend(guardian, [childA, childB], { childAccountId: childB, body: 'about B' })
    const [thread] = await h.sql`select chapter_id from message_thread where id = ${msg.threadId}`
    expect(thread!.chapter_id).toBe(chapterB)
  })
})

// ===========================================================================
describe('MessagingService — staff read + reply', () => {
  test('staff list the chapter’s threads, read one, and reply (director -> director, mentor -> mentor)', async () => {
    const chapter = await makeChapter(h.sql)
    const child = await seedChild(chapter)
    const guardian = await makeAdult(h.sql)
    const director = await makeAdult(h.sql)
    const mentor = await makeAdult(h.sql)
    const t = await guardianSend(guardian, [child], { subject: 'Q', body: 'A question' })

    // Director lists + reads.
    let list!: Awaited<ReturnType<MessagingService['listStaffThreads']>>
    await withRequest(async () => {
      list = await svc().listStaffThreads(directorCtx(director, chapter), { chapterId: chapter })
    })
    expect(list.items).toHaveLength(1)
    expect(list.items[0]!.id).toBe(t.threadId)
    expect(typeof list.items[0]!.guardianName).toBe('string')
    expect(list.items[0]!.lastMessage!.body).toBe('A question')

    let detail!: Awaited<ReturnType<MessagingService['getStaffThread']>>
    await withRequest(async () => {
      detail = await svc().getStaffThread(t.threadId, directorCtx(director, chapter))
    })
    expect(detail.messages).toHaveLength(1)

    // Director reply -> sender_role 'director'.
    let dReply!: Awaited<ReturnType<MessagingService['replyStaffMessage']>>
    await withRequest(async () => {
      dReply = await svc().replyStaffMessage(t.threadId, { body: 'Director here' }, directorCtx(director, chapter))
    })
    expect(dReply).toMatchObject({ senderAccountId: director, senderRole: 'director', body: 'Director here' })

    // Mentor reply -> sender_role 'mentor'.
    let mReply!: Awaited<ReturnType<MessagingService['replyStaffMessage']>>
    await withRequest(async () => {
      mReply = await svc().replyStaffMessage(t.threadId, { body: 'Mentor here' }, mentorCtx(mentor, chapter))
    })
    expect(mReply).toMatchObject({ senderAccountId: mentor, senderRole: 'mentor' })

    // The guardian read shows all three messages in order.
    let gv!: Awaited<ReturnType<MessagingService['viewGuardianThreads']>>
    await withRequest(async () => {
      gv = await svc().viewGuardianThreads(guardianCtx(guardian, [child]))
    })
    expect(gv.items).toHaveLength(1)
    expect(gv.items[0]!.messages.map((m) => m.senderRole)).toEqual(['guardian', 'director', 'mentor'])
  })

  test('a non-staff caller cannot list threads (Forbidden); a staff member of ANOTHER chapter cannot read or reply', async () => {
    const chapter = await makeChapter(h.sql)
    const otherChapter = await makeChapter(h.sql)
    const child = await seedChild(chapter)
    const guardian = await makeAdult(h.sql)
    const t = await guardianSend(guardian, [child], { body: 'hi' })

    const intruder = await makeAdult(h.sql)
    // A mentor of ANOTHER chapter requests this chapter's threads.
    let listCaught: unknown
    await withRequest(async () => {
      try {
        await svc().listStaffThreads(mentorCtx(intruder, otherChapter), { chapterId: chapter })
      } catch (e) {
        listCaught = e
      }
    })
    expect(listCaught).toBeInstanceOf(Forbidden)

    // ...and cannot read the thread detail.
    let readCaught: unknown
    await withRequest(async () => {
      try {
        await svc().getStaffThread(t.threadId, mentorCtx(intruder, otherChapter))
      } catch (e) {
        readCaught = e
      }
    })
    expect(readCaught).toBeInstanceOf(Forbidden)

    // ...and cannot reply.
    let replyCaught: unknown
    await withRequest(async () => {
      try {
        await svc().replyStaffMessage(t.threadId, { body: 'no' }, mentorCtx(intruder, otherChapter))
      } catch (e) {
        replyCaught = e
      }
    })
    expect(replyCaught).toBeInstanceOf(Forbidden)
    const rows = await h.sql`select id from message where thread_id = ${t.threadId}`
    expect(rows).toHaveLength(1)
  })

  test('replying to an unknown thread is a not-found', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    await withRequest(async () => {
      await expect(
        svc().replyStaffMessage(randomUUID(), { body: 'x' }, directorCtx(director, chapter)),
      ).rejects.toThrow(MessageThreadNotFoundError)
    })
  })
})

// ===========================================================================
describe('MessagingService — append-only + last_message_at advances', () => {
  test('last_message_at advances forward as replies append; the thread + all messages persist', async () => {
    const chapter = await makeChapter(h.sql)
    const child = await seedChild(chapter)
    const guardian = await makeAdult(h.sql)
    const director = await makeAdult(h.sql)
    const t = await guardianSend(guardian, [child], { body: 'first' })

    const [before] = await h.sql`select last_message_at, created_at from message_thread_current where id = ${t.threadId}`

    await withRequest(async () => {
      await svc().replyStaffMessage(t.threadId, { body: 'reply' }, directorCtx(director, chapter))
    })
    const [after] = await h.sql`select last_message_at from message_thread_current where id = ${t.threadId}`
    expect(new Date(after!.last_message_at as string).getTime()).toBeGreaterThanOrEqual(
      new Date(before!.last_message_at as string).getTime(),
    )

    // Nothing was deleted or edited: both messages + the thread persist.
    const msgs = await h.sql`select id from message where thread_id = ${t.threadId}`
    expect(msgs).toHaveLength(2)
    const threads = await h.sql`select id from message_thread where id = ${t.threadId}`
    expect(threads).toHaveLength(1)
  })
})

// ===========================================================================
describe('MessagingService — audit + access ledger', () => {
  test('a guardian send writes an audit + access-ledger row; a staff reply writes another', async () => {
    const chapter = await makeChapter(h.sql)
    const child = await seedChild(chapter)
    const guardian = await makeAdult(h.sql)
    const director = await makeAdult(h.sql)
    const t = await guardianSend(guardian, [child], { body: 'hello' })

    const sendAudit = await h.sql`
      select detail, chapter_id from audit_entry
      where action = 'message.sent' and actor_account_id = ${guardian}
    `
    expect(sendAudit).toHaveLength(1)
    expect(sendAudit[0]!.chapter_id).toBe(chapter)
    expect(sendAudit[0]!.detail).toMatchObject({ threadId: t.threadId })

    const sendLedger = await h.sql`
      select event, chapter_id from access_ledger
      where event = 'message.sent' and actor_account_id = ${guardian}
    `
    expect(sendLedger).toHaveLength(1)
    expect(sendLedger[0]!.chapter_id).toBe(chapter)

    await withRequest(async () => {
      await svc().replyStaffMessage(t.threadId, { body: 'reply' }, directorCtx(director, chapter))
    })
    const replyLedger = await h.sql`
      select detail from access_ledger
      where event = 'message.replied' and actor_account_id = ${director}
    `
    expect(replyLedger).toHaveLength(1)
    expect(replyLedger[0]!.detail).toMatchObject({ threadId: t.threadId })
  })
})
