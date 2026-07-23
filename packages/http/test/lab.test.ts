// -------------------------------------------------------------------------
// The Lab HTTP controllers (05-api-surface.md "The Lab"; milestone-2.md §M2.6).
// Embedded Postgres, synthetic data only. Every actor is a REAL db account with
// a live session token, so the controllers resolve a real AuthContext from the
// cookie (context.ts) — not an injected ctx.
//
// Task acceptance:
//   - a consented member posts and comments (2xx); a minor WITHOUT
//     platform_participation is an opaque 403; an alumni commenting is a 403;
//   - filing a report (2xx) and the lifecycle ack -> resolve; a minor mentor
//     resolving is a 403 (moderation.resolve age gate);
//   - feed.hide_safety by an out-of-pod instructor hides + auto-files a report;
//   - the feed controller returns scoped results and 403s a wrong-chapter caller.
// -------------------------------------------------------------------------

import { beforeAll, afterAll, describe, expect, test, vi } from 'vitest'
import { createSession } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMembership, makeMinor, makePod, makeTerm } from './helpers/fixtures.js'
import {
  viewFeed,
  createPost,
  editPost,
  createComment,
  addReaction,
  removeReaction,
  fileReport,
  hidePost,
  removePost,
  moderationQueue,
  transitionReport,
} from '../src/index.js'

// The route adapters read the session via `cookies()` from next/headers, which
// requires Next's request-scope store — absent when a handler is called directly
// in vitest. Mock it to serve a seeded session token (the "seeded-session path"),
// so the smoke test exercises the real adapter -> controller -> db seam. Only the
// smoke test imports a route module; the controller tests below call controllers
// directly and never touch next/headers.
const cookieState = vi.hoisted(() => ({ token: null as string | null }))
vi.mock('next/headers', () => ({
  cookies: (): Promise<{ get: (name: string) => { value: string } | undefined }> =>
    Promise.resolve({
      get: (): { value: string } | undefined =>
        cookieState.token !== null ? { value: cookieState.token } : undefined,
    }),
}))

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

// --- seed helpers ----------------------------------------------------------

async function tokenFor(accountId: string): Promise<string> {
  const { token } = await createSession(h.sql, {
    accountId,
    expiresAt: new Date(Date.now() + 3_600_000),
  })
  return token
}

interface LabMember {
  accountId: string
  membershipId: string
  token: string
}

/** A real account + active membership of `role` in `chapter`, with a session token. */
async function labMember(
  chapter: string,
  role: string,
  opts: { podId?: string | null; minor?: boolean; participation?: boolean } = {},
): Promise<LabMember> {
  const accountId = opts.minor ? await makeMinor(h.sql) : await makeAdult(h.sql)
  const membershipId = await makeMembership(h.sql, accountId, chapter, {
    role,
    status: 'active',
    podId: opts.podId ?? null,
  })
  if (opts.participation) {
    await h.sql`
      insert into consent (student_account_id, type, action, source, effective_at, reason)
      values (${accountId}, 'platform_participation', 'grant', 'digital', '2025-01-01', 'standard')
    `
  }
  return { accountId, membershipId, token: await tokenFor(accountId) }
}

/** A published wip post authored by a fresh chapter instructor (optionally in a pod). */
async function seedPost(
  chapter: string,
  opts: { podId?: string | null } = {},
): Promise<{ postId: string; author: LabMember }> {
  // Only student / junior_mentor memberships may carry a pod (membership_pod_scope).
  const role = opts.podId != null ? 'junior_mentor' : 'senior_instructor'
  const author = await labMember(chapter, role, { podId: opts.podId ?? null })
  const [row] = await h.sql`
    insert into post (chapter_id, pod_id, author_membership_id, type, body)
    values (${chapter}, ${opts.podId ?? null}, ${author.membershipId}, 'wip', 'Hello Lab')
    returning id
  `
  return { postId: row!.id as string, author }
}

async function postRow(postId: string) {
  const [row] = await h.sql`select status, body from post where id = ${postId}`
  return row
}

// ===========================================================================
describe('createPost / editPost', () => {
  test('a consented minor member posts (201) authored by their in-scope membership', async () => {
    const chapter = await makeChapter(h.sql)
    const m = await labMember(chapter, 'student', { minor: true, participation: true })

    const res = await createPost({
      sql: h.sql,
      sessionToken: m.token,
      body: { chapterId: chapter, type: 'question', body: 'help?' },
    })
    expect(res.status).toBe(201)
    expect(res.body.status).toBe('published')
    expect(res.body.authorMembershipId).toBe(m.membershipId)
  })

  test('a minor WITHOUT platform_participation is an opaque 403 (no reason leaked), no row', async () => {
    const chapter = await makeChapter(h.sql)
    const m = await labMember(chapter, 'student', { minor: true })

    const res = await createPost({
      sql: h.sql,
      sessionToken: m.token,
      body: { chapterId: chapter, type: 'question', body: 'help?' },
    })
    expect(res.status).toBe(403)
    expect(JSON.stringify(res.body)).not.toMatch(/actor_consent_missing|reason|out_of_scope/)
    const [c] = await h.sql`select count(*)::int as n from post where chapter_id = ${chapter}`
    expect(c!.n).toBe(0)
  })

  test('no session is an opaque 403', async () => {
    const chapter = await makeChapter(h.sql)
    const res = await createPost({ sql: h.sql, body: { chapterId: chapter, type: 'wip', body: 'x' } })
    expect(res.status).toBe(403)
  })

  test('a milestone-type post is rejected (400, system path only)', async () => {
    const chapter = await makeChapter(h.sql)
    const m = await labMember(chapter, 'chapter_director')
    const res = await createPost({
      sql: h.sql,
      sessionToken: m.token,
      body: { chapterId: chapter, type: 'milestone', body: 'x' },
    })
    expect(res.status).toBe(400)
  })

  test('the author edits their own post (200); a non-author is a 403', async () => {
    const chapter = await makeChapter(h.sql)
    const author = await labMember(chapter, 'senior_instructor')
    const created = await createPost({
      sql: h.sql,
      sessionToken: author.token,
      body: { chapterId: chapter, type: 'wip', body: 'draft' },
    })
    const postId = created.body.postId

    const ok = await editPost({
      sql: h.sql,
      sessionToken: author.token,
      params: { id: postId },
      body: { body: 'revised' },
    })
    expect(ok.status).toBe(200)
    expect((await postRow(postId))!.body).toBe('revised')

    const other = await labMember(chapter, 'senior_instructor')
    const denied = await editPost({
      sql: h.sql,
      sessionToken: other.token,
      params: { id: postId },
      body: { body: 'hijack' },
    })
    expect(denied.status).toBe(403)
    expect((await postRow(postId))!.body).toBe('revised')
  })
})

// ===========================================================================
describe('createComment', () => {
  test('a consented member comments on a post (201)', async () => {
    const chapter = await makeChapter(h.sql)
    const { postId } = await seedPost(chapter)
    const m = await labMember(chapter, 'student', { minor: true, participation: true })

    const res = await createComment({
      sql: h.sql,
      sessionToken: m.token,
      params: { id: postId },
      body: { body: 'nice work' },
    })
    expect(res.status).toBe(201)
    expect(res.body.status).toBe('published')
  })

  test('an alumni commenting is an opaque 403 (role_not_permitted), no row', async () => {
    const chapter = await makeChapter(h.sql)
    const { postId } = await seedPost(chapter)
    const alum = await labMember(chapter, 'alumni')

    const res = await createComment({
      sql: h.sql,
      sessionToken: alum.token,
      params: { id: postId },
      body: { body: 'x' },
    })
    expect(res.status).toBe(403)
    expect(JSON.stringify(res.body)).not.toMatch(/role_not_permitted|reason/)
    const [c] = await h.sql`select count(*)::int as n from comment where post_id = ${postId}`
    expect(c!.n).toBe(0)
  })
})

// ===========================================================================
describe('addReaction / removeReaction', () => {
  test('a member reacts to a post (201) then unreacts (200)', async () => {
    const chapter = await makeChapter(h.sql)
    const { postId } = await seedPost(chapter)
    const m = await labMember(chapter, 'student', { minor: true, participation: true })

    const add = await addReaction({
      sql: h.sql,
      sessionToken: m.token,
      targetType: 'post',
      params: { id: postId },
      body: { kind: 'like' },
    })
    expect(add.status).toBe(201)
    let [c] = await h.sql`select count(*)::int as n from reaction where target_id = ${postId}`
    expect(c!.n).toBe(1)

    const rm = await removeReaction({
      sql: h.sql,
      sessionToken: m.token,
      targetType: 'post',
      params: { id: postId },
      body: { kind: 'like' },
    })
    expect(rm.status).toBe(200)
    ;[c] = await h.sql`select count(*)::int as n from reaction where target_id = ${postId}`
    expect(c!.n).toBe(0)
  })
})

// ===========================================================================
describe('viewFeed', () => {
  test('an in-chapter participant reads scoped, published results (200)', async () => {
    const chapter = await makeChapter(h.sql)
    const { postId } = await seedPost(chapter)
    const reader = await labMember(chapter, 'senior_instructor')

    const res = await viewFeed({
      sql: h.sql,
      sessionToken: reader.token,
      query: { chapterId: chapter },
    })
    expect(res.status).toBe(200)
    expect(res.body.posts.some((p) => p.postId === postId)).toBe(true)
    expect(res.body.posts.every((p) => p.chapterId === chapter)).toBe(true)
  })

  test('a wrong-chapter caller is an opaque 403', async () => {
    const chapter = await makeChapter(h.sql)
    await seedPost(chapter)
    const otherChapter = await makeChapter(h.sql)
    const outsider = await labMember(otherChapter, 'senior_instructor')

    const res = await viewFeed({
      sql: h.sql,
      sessionToken: outsider.token,
      query: { chapterId: chapter },
    })
    expect(res.status).toBe(403)
  })
})

// ===========================================================================
describe('fileReport + moderation lifecycle', () => {
  test('a member files a report (201); a director acks then resolves (200 each)', async () => {
    const chapter = await makeChapter(h.sql)
    const { postId } = await seedPost(chapter)
    const reporter = await labMember(chapter, 'senior_instructor')

    const filed = await fileReport({
      sql: h.sql,
      sessionToken: reporter.token,
      body: { targetType: 'post', targetId: postId, class: 'ordinary', reason: 'unkind' },
    })
    expect(filed.status).toBe(201)
    const reportId = filed.body.reportId

    const director = await labMember(chapter, 'chapter_director')
    const ack = await transitionReport({
      sql: h.sql,
      sessionToken: director.token,
      action: 'ack',
      params: { id: reportId },
      body: {},
    })
    expect(ack.status).toBe(200)

    const resolved = await transitionReport({
      sql: h.sql,
      sessionToken: director.token,
      action: 'resolve',
      params: { id: reportId },
      body: { action: 'dismissed' },
    })
    expect(resolved.status).toBe(200)
    const [row] = await h.sql`select resolved_at from moderation_report where id = ${reportId}`
    expect(row!.resolved_at).not.toBeNull()
  })

  test('a minor mentor resolving is an opaque 403 (moderation.resolve age gate)', async () => {
    const chapter = await makeChapter(h.sql)
    const { postId } = await seedPost(chapter)
    const reporter = await labMember(chapter, 'senior_instructor')
    const filed = await fileReport({
      sql: h.sql,
      sessionToken: reporter.token,
      body: { targetType: 'post', targetId: postId, class: 'safety', reason: 'threatening' },
    })
    const reportId = filed.body.reportId

    const director = await labMember(chapter, 'chapter_director')
    await transitionReport({
      sql: h.sql,
      sessionToken: director.token,
      action: 'ack',
      params: { id: reportId },
      body: {},
    })

    // A minor junior_mentor cannot resolve (moderation.resolve age >= 18 gate);
    // makeMinor's DOB already yields an under-18 actor.
    const minorMentor = await labMember(chapter, 'junior_mentor', { minor: true })

    const res = await transitionReport({
      sql: h.sql,
      sessionToken: minorMentor.token,
      action: 'resolve',
      params: { id: reportId },
      body: { action: 'dismissed' },
    })
    expect(res.status).toBe(403)
    const [row] = await h.sql`select resolved_at from moderation_report where id = ${reportId}`
    expect(row!.resolved_at).toBeNull()
  })

  test('the moderation queue returns unresolved reports ordered by due_at (200)', async () => {
    const chapter = await makeChapter(h.sql)
    const { postId } = await seedPost(chapter)
    const reporter = await labMember(chapter, 'senior_instructor')
    const safety = await fileReport({
      sql: h.sql,
      sessionToken: reporter.token,
      body: { targetType: 'post', targetId: postId, class: 'safety', reason: 'threatening' },
    })
    const ordinary = await fileReport({
      sql: h.sql,
      sessionToken: reporter.token,
      body: { targetType: 'post', targetId: postId, class: 'ordinary', reason: 'spam' },
    })

    const director = await labMember(chapter, 'chapter_director')
    const res = await moderationQueue({
      sql: h.sql,
      sessionToken: director.token,
      query: { chapterId: chapter },
    })
    expect(res.status).toBe(200)
    const ids = res.body.reports.map((r) => r.reportId)
    expect(ids).toContain(safety.body.reportId)
    expect(ids).toContain(ordinary.body.reportId)
    // safety (24h SLA) is due before ordinary (72h), so it sorts first.
    expect(ids.indexOf(safety.body.reportId)).toBeLessThan(ids.indexOf(ordinary.body.reportId))
  })

  test('a non-moderator (student) is an opaque 403 on the queue', async () => {
    const chapter = await makeChapter(h.sql)
    const student = await labMember(chapter, 'student', { minor: true, participation: true })
    const res = await moderationQueue({
      sql: h.sql,
      sessionToken: student.token,
      query: { chapterId: chapter },
    })
    expect(res.status).toBe(403)
  })
})

// ===========================================================================
describe('hidePost: feed.moderate hide and feed.hide_safety', () => {
  test('a moderator hides then removes a post (200 each)', async () => {
    const chapter = await makeChapter(h.sql)
    const { postId } = await seedPost(chapter)
    const modr = await labMember(chapter, 'lead_instructor')

    const hidden = await hidePost({
      sql: h.sql,
      sessionToken: modr.token,
      params: { id: postId },
      body: {},
    })
    expect(hidden.status).toBe(200)
    expect((await postRow(postId))!.status).toBe('hidden')

    const removed = await removePost({
      sql: h.sql,
      sessionToken: modr.token,
      params: { id: postId },
    })
    expect(removed.status).toBe(200)
    const row = await postRow(postId)
    expect(row!.status).toBe('removed')
    expect(row!.body).toBe('')
  })

  test('an out-of-pod instructor hide_safety hides the post and auto-files a safety report', async () => {
    const chapter = await makeChapter(h.sql)
    const term = await makeTerm(h.sql, chapter)
    const podA = await makePod(h.sql, chapter, term)
    const podB = await makePod(h.sql, chapter, term)
    const { postId } = await seedPost(chapter, { podId: podA })

    // A junior_mentor assigned to podB — NOT the post's pod — may still hide it
    // (feed.hide_safety is chapter-scoped, not pod-bound).
    const mentor = await labMember(chapter, 'junior_mentor', { podId: podB })

    const res = await hidePost({
      sql: h.sql,
      sessionToken: mentor.token,
      params: { id: postId },
      body: { safety: true, reason: 'threatening' },
    })
    expect(res.status).toBe(200)
    expect((await postRow(postId))!.status).toBe('hidden')
    const reports = await h.sql`select class from moderation_report where target_id = ${postId} and target_type = 'post'`
    expect(reports).toHaveLength(1)
    expect(reports[0]!.class).toBe('safety')
  })
})

// ===========================================================================
describe('route adapter smoke test', () => {
  test('POST /api/lab/posts adapter returns a real Response for a seeded session', async () => {
    const { setSqlForTesting } = await import('../src/index.js')
    setSqlForTesting(h.sql)
    try {
      const chapter = await makeChapter(h.sql)
      const author = await labMember(chapter, 'senior_instructor')
      cookieState.token = author.token

      const { POST } = await import('../../../app/api/lab/posts/route.js')
      const req = new Request('http://localhost/api/lab/posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chapterId: chapter, type: 'wip', body: 'via adapter' }),
      })
      const res = await POST(req)
      expect(res).toBeInstanceOf(Response)
      expect(res.status).toBe(201)
      const body = (await res.json()) as { postId: string }
      expect(body.postId).toBeTruthy()
    } finally {
      setSqlForTesting(null)
      cookieState.token = null
    }
  })
})
