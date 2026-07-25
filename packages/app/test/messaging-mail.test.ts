// -------------------------------------------------------------------------
// MessagingService email notifications (guardian <-> chapter-staff, system A —
// the plaintext "Gmail-style" messages). Wiring the existing Mailer seam so a
// portal message ALSO lands in the recipient's real inbox:
//
//   - a guardian SEND notifies the chapter's teaching staff (director + mentors)
//     at their account email, body included (system A is plaintext);
//   - a staff REPLY notifies the thread's guardian at their account email;
//   - a recipient with NO account email is skipped silently (no crash, no gap) —
//     children/username-only accounts simply get no email;
//   - best-effort: a mailer failure does NOT roll back the append-only message.
//
// Embedded Postgres, synthetic data only, with a FakeMailer (no real send).
// -------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { authorize, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMembership, makeMinor } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import { MessagingService, FakeMailer, type MessagingAuthorizeFn, type Mailer } from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

const NOW = new Date('2025-01-01T00:00:00.000Z')

function svc(mailer: Mailer) {
  return new MessagingService({
    sql: h.sql,
    authorize: authorize as unknown as MessagingAuthorizeFn,
    mailer,
  })
}

function guardianCtx(guardian: string, children: string[]) {
  return { ...baseCtx(guardian, NOW, []), guardianOf: children }
}
function directorCtx(director: string, chapter: string) {
  return baseCtx(director, NOW, [mem('chapter_director', chapter)])
}

/** A verified-and-enrolled minor child with an active student membership in chapter. */
async function seedChild(chapter: string): Promise<string> {
  const child = await makeMinor(h.sql, { dateOfBirth: '2015-06-01' })
  await makeMembership(h.sql, child, chapter, { role: 'student', status: 'active' })
  return child
}

function bodyOf(msg: { html?: string; text?: string }): string {
  return `${msg.html ?? ''}\n${msg.text ?? ''}`
}

// ===========================================================================
describe('MessagingService — email notification on guardian send', () => {
  test('a guardian send notifies every teaching-staff email exactly once, carrying the body', async () => {
    const chapter = await makeChapter(h.sql)
    const child = await seedChild(chapter)
    const guardian = await makeAdult(h.sql)
    const directorEmail = `dir-${Math.round(NOW.getTime())}-a@example.test`
    const mentorEmail = `men-${Math.round(NOW.getTime())}-a@example.test`
    const director = await makeAdult(h.sql, { email: directorEmail })
    const mentor = await makeAdult(h.sql, { email: mentorEmail })
    await makeMembership(h.sql, director, chapter, { role: 'chapter_director', status: 'active' })
    await makeMembership(h.sql, mentor, chapter, { role: 'junior_mentor', status: 'active' })

    const mailer = new FakeMailer()
    await withRequest(async () => {
      await svc(mailer).sendGuardianMessage({ body: 'Running 10 min late' }, guardianCtx(guardian, [child]))
    })

    const toDirector = mailer.sent.filter((m) => m.to === directorEmail)
    const toMentor = mailer.sent.filter((m) => m.to === mentorEmail)
    expect(toDirector).toHaveLength(1)
    expect(toMentor).toHaveLength(1)
    expect(toDirector[0]!.subject.length).toBeGreaterThan(0)
    expect(bodyOf(toDirector[0]!)).toContain('Running 10 min late')
    // The child (username-only, no email) is never a recipient.
    expect(mailer.sent.every((m) => typeof m.to === 'string' && m.to.includes('@'))).toBe(true)
  })
})

// ===========================================================================
describe('MessagingService — email notification on staff reply', () => {
  test('a staff reply emails the thread’s guardian with the reply body', async () => {
    const chapter = await makeChapter(h.sql)
    const child = await seedChild(chapter)
    const guardianEmail = `guardian-reply-${Math.round(NOW.getTime())}@example.test`
    const guardian = await makeAdult(h.sql, { email: guardianEmail })
    const director = await makeAdult(h.sql)
    await makeMembership(h.sql, director, chapter, { role: 'chapter_director', status: 'active' })

    const mailer = new FakeMailer()
    let threadId!: string
    await withRequest(async () => {
      const first = await svc(new FakeMailer()).sendGuardianMessage({ body: 'A question' }, guardianCtx(guardian, [child]))
      threadId = first.threadId
    })
    await withRequest(async () => {
      await svc(mailer).replyStaffMessage(threadId, { body: 'Director here with the answer' }, directorCtx(director, chapter))
    })

    const toGuardian = mailer.sent.filter((m) => m.to === guardianEmail)
    expect(toGuardian).toHaveLength(1)
    expect(bodyOf(toGuardian[0]!)).toContain('Director here with the answer')
  })

  test('a guardian with NO account email is skipped silently on staff reply (no send, no crash)', async () => {
    const chapter = await makeChapter(h.sql)
    const child = await seedChild(chapter)
    // A guardian account identified by username only (no email) — the child case.
    const guardian = await makeAdult(h.sql, { email: null, username: `noemail-${Math.round(NOW.getTime())}` })
    const director = await makeAdult(h.sql)
    await makeMembership(h.sql, director, chapter, { role: 'chapter_director', status: 'active' })

    const mailer = new FakeMailer()
    let threadId!: string
    await withRequest(async () => {
      const first = await svc(new FakeMailer()).sendGuardianMessage({ body: 'A question' }, guardianCtx(guardian, [child]))
      threadId = first.threadId
    })
    await withRequest(async () => {
      await svc(mailer).replyStaffMessage(threadId, { body: 'no inbox to reach' }, directorCtx(director, chapter))
    })

    expect(mailer.sent).toHaveLength(0)
  })
})

// ===========================================================================
describe('MessagingService — best-effort delivery', () => {
  test('a mailer failure does NOT roll back the append-only message', async () => {
    const chapter = await makeChapter(h.sql)
    const child = await seedChild(chapter)
    const guardian = await makeAdult(h.sql)
    const director = await makeAdult(h.sql, { email: `boom-${Math.round(NOW.getTime())}@example.test` })
    await makeMembership(h.sql, director, chapter, { role: 'chapter_director', status: 'active' })

    const throwing: Mailer = { send: async () => { throw new Error('mail transport down') } }

    let messageId!: string
    let threadId!: string
    await withRequest(async () => {
      const msg = await svc(throwing).sendGuardianMessage({ body: 'still recorded' }, guardianCtx(guardian, [child]))
      messageId = msg.id
      threadId = msg.threadId
    })

    // The message persisted despite the failed send.
    const rows = await h.sql`select id, body from message where id = ${messageId}`
    expect(rows).toHaveLength(1)
    expect(rows[0]!.body).toBe('still recorded')
    const threads = await h.sql`select id from message_thread where id = ${threadId}`
    expect(threads).toHaveLength(1)
  })
})
