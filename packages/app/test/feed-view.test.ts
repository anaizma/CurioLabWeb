// -------------------------------------------------------------------------
// Milestone 2.3 — FeedService.view: the Lab feed read + filters.
//
// Test-first (RED before GREEN). The read is gated through the injected
// `authorize` under `feed.view` (03-authorization.md), scoped to the actor's
// chapter/pod. Ordinary viewers see only `published`; a `feed.moderate` holder
// may opt into `hidden` via `includeHidden`; `removed` is never returned.
//
// Read-logging (milestone-2.md §M2.3): a query that surfaces content authored by
// a minor from OUTSIDE the actor's pod writes exactly ONE `minor_record.read`
// audit entry for that query (not per post), in the SAME transaction as the read
// so a failed audit fails closed. An in-pod read logs nothing.
//
// Embedded Postgres, synthetic data only.
// -------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Forbidden, authorize, withRequest, type AuditEntryInput } from '@curiolab/runtime'
import type { AuthContext, ConsentSet, Membership } from '@curiolab/core'
import type { Sql, TransactionSql } from 'postgres'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMembership, makeMinor, makePod, makeTerm } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import { FeedService, type FeedAuthorizeFn } from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

// --- ctx builders ----------------------------------------------------------

function feedCtx(
  accountId: string,
  memberships: Membership[],
  opts: { age?: number; consents?: ConsentSet } = {},
): AuthContext {
  const c = baseCtx(accountId, new Date(), memberships)
  if (opts.age !== undefined) c.account.age = opts.age
  if (opts.age !== undefined && opts.age < 18) c.account.maturation_state = 'minor'
  if (opts.consents) c.consentsByChild = new Map([[accountId, opts.consents]])
  return c
}

// --- fixtures --------------------------------------------------------------

async function member(
  chapter: string,
  role: string,
  opts: { podId?: string | null } = {},
): Promise<{ accountId: string; membershipId: string }> {
  const accountId = role === 'student' ? await makeMinor(h.sql) : await makeAdult(h.sql)
  const membershipId = await makeMembership(h.sql, accountId, chapter, {
    role,
    status: 'active',
    podId: opts.podId ?? null,
  })
  return { accountId, membershipId }
}

/** An account that is definitely a minor (young DOB), plus a membership. */
async function minorMember(
  chapter: string,
  role: string,
  opts: { podId?: string | null } = {},
): Promise<{ accountId: string; membershipId: string }> {
  const accountId = await makeMinor(h.sql, { dateOfBirth: '2015-06-01' })
  const membershipId = await makeMembership(h.sql, accountId, chapter, {
    role,
    status: 'active',
    podId: opts.podId ?? null,
  })
  return { accountId, membershipId }
}

interface InsertPostOpts {
  chapterId: string
  podId?: string | null
  authorMembershipId: string
  type?: string
  body?: string
  status?: 'published' | 'hidden' | 'removed'
  createdAt?: string
}

async function insertPost(o: InsertPostOpts): Promise<string> {
  const [row] = o.createdAt
    ? await h.sql`
        insert into post (chapter_id, pod_id, author_membership_id, type, body, status, created_at)
        values (${o.chapterId}, ${o.podId ?? null}, ${o.authorMembershipId}, ${o.type ?? 'wip'}, ${o.body ?? 'x'}, ${o.status ?? 'published'}, ${o.createdAt})
        returning id`
    : await h.sql`
        insert into post (chapter_id, pod_id, author_membership_id, type, body, status)
        values (${o.chapterId}, ${o.podId ?? null}, ${o.authorMembershipId}, ${o.type ?? 'wip'}, ${o.body ?? 'x'}, ${o.status ?? 'published'})
        returning id`
  return row!.id as string
}

function svc(
  authorizeFn = authorize as unknown as FeedAuthorizeFn,
  auditWriter?: (sql: Sql | TransactionSql, entry: AuditEntryInput) => Promise<string>,
): FeedService {
  return new FeedService({ sql: h.sql, authorize: authorizeFn, auditWriter })
}

async function minorReadLogs(actorAccountId: string) {
  return h.sql`
    select subject_type, subject_id, detail from audit_entry
    where action='minor_record.read' and actor_account_id=${actorAccountId}
  `
}

// ===========================================================================
describe('FeedService.view — scope', () => {
  test('a pod member sees their pod published posts (filtered to their pod)', async () => {
    const chapter = await makeChapter(h.sql)
    const term = await makeTerm(h.sql, chapter)
    const podA = await makePod(h.sql, chapter, term)
    const podB = await makePod(h.sql, chapter, term)
    const student = await minorMember(chapter, 'student', { podId: podA })
    const other = await member(chapter, 'senior_instructor')

    const inA = await insertPost({ chapterId: chapter, podId: podA, authorMembershipId: other.membershipId, body: 'in A' })
    await insertPost({ chapterId: chapter, podId: podB, authorMembershipId: other.membershipId, body: 'in B' })

    const ctx = feedCtx(student.accountId, [{ ...mem('student', chapter), pod_id: podA }], {
      age: 13,
      consents: { platform_participation: { active: true } },
    })

    let result!: Awaited<ReturnType<FeedService['view']>>
    await withRequest(async () => {
      result = await svc().view(ctx, { chapterId: chapter, podId: podA })
    })
    expect(result.posts.map((p) => p.postId)).toEqual([inA])
  })

  test('a chapter-scoped actor sees the whole chapter (pod + chapter-level)', async () => {
    const chapter = await makeChapter(h.sql)
    const term = await makeTerm(h.sql, chapter)
    const pod = await makePod(h.sql, chapter, term)
    const author = await member(chapter, 'senior_instructor')
    const instructor = await member(chapter, 'lead_instructor')

    const p1 = await insertPost({ chapterId: chapter, podId: pod, authorMembershipId: author.membershipId, createdAt: '2099-01-01T00:00:00Z' })
    const p2 = await insertPost({ chapterId: chapter, podId: null, authorMembershipId: author.membershipId, createdAt: '2099-01-02T00:00:00Z' })

    const ctx = feedCtx(instructor.accountId, [mem('lead_instructor', chapter)])
    let result!: Awaited<ReturnType<FeedService['view']>>
    await withRequest(async () => {
      result = await svc().view(ctx, { chapterId: chapter })
    })
    expect(new Set(result.posts.map((p) => p.postId))).toEqual(new Set([p1, p2]))
  })

  test('an actor from a different chapter is denied (out_of_scope), no data', async () => {
    const chapter = await makeChapter(h.sql)
    const otherChapter = await makeChapter(h.sql)
    const author = await member(chapter, 'senior_instructor')
    await insertPost({ chapterId: chapter, authorMembershipId: author.membershipId })
    const stranger = await member(otherChapter, 'senior_instructor')
    const ctx = feedCtx(stranger.accountId, [mem('senior_instructor', otherChapter)])

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().view(ctx, { chapterId: chapter })
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
    expect(JSON.stringify(caught)).not.toMatch(/out_of_scope/)
    const denied = await h.sql`select detail from audit_entry where action='permission.denied' and actor_account_id=${stranger.accountId}`
    expect(denied[0]!.detail).toMatchObject({ capability: 'feed.view', reason: 'out_of_scope' })
  })
})

// ===========================================================================
describe('FeedService.view — filters and pagination', () => {
  test('filter by type', async () => {
    const chapter = await makeChapter(h.sql)
    const author = await member(chapter, 'senior_instructor')
    await insertPost({ chapterId: chapter, authorMembershipId: author.membershipId, type: 'wip' })
    const q = await insertPost({ chapterId: chapter, authorMembershipId: author.membershipId, type: 'question' })
    await insertPost({ chapterId: chapter, authorMembershipId: author.membershipId, type: 'session_recap' })
    const ctx = feedCtx(author.accountId, [mem('senior_instructor', chapter)])
    let result!: Awaited<ReturnType<FeedService['view']>>
    await withRequest(async () => {
      result = await svc().view(ctx, { chapterId: chapter, type: 'question' })
    })
    expect(result.posts.map((p) => p.postId)).toEqual([q])
  })

  test('filter by author_membership_id', async () => {
    const chapter = await makeChapter(h.sql)
    const a1 = await member(chapter, 'senior_instructor')
    const a2 = await member(chapter, 'senior_instructor')
    const mine = await insertPost({ chapterId: chapter, authorMembershipId: a1.membershipId })
    await insertPost({ chapterId: chapter, authorMembershipId: a2.membershipId })
    const ctx = feedCtx(a1.accountId, [mem('senior_instructor', chapter)])
    let result!: Awaited<ReturnType<FeedService['view']>>
    await withRequest(async () => {
      result = await svc().view(ctx, { chapterId: chapter, authorMembershipId: a1.membershipId })
    })
    expect(result.posts.map((p) => p.postId)).toEqual([mine])
  })

  test('pagination returns stable, disjoint pages ordered newest-first', async () => {
    const chapter = await makeChapter(h.sql)
    const author = await member(chapter, 'senior_instructor')
    const ids: string[] = []
    for (let i = 0; i < 5; i++) {
      ids.push(
        await insertPost({
          chapterId: chapter,
          authorMembershipId: author.membershipId,
          body: `p${i}`,
          createdAt: `2099-03-0${i + 1}T00:00:00Z`,
        }),
      )
    }
    // newest-first => reverse insertion order
    const expected = [...ids].reverse()
    const ctx = feedCtx(author.accountId, [mem('senior_instructor', chapter)])

    let page1!: Awaited<ReturnType<FeedService['view']>>
    let page2!: Awaited<ReturnType<FeedService['view']>>
    let page3!: Awaited<ReturnType<FeedService['view']>>
    await withRequest(async () => {
      page1 = await svc().view(ctx, { chapterId: chapter, limit: 2, offset: 0 })
      page2 = await svc().view(ctx, { chapterId: chapter, limit: 2, offset: 2 })
      page3 = await svc().view(ctx, { chapterId: chapter, limit: 2, offset: 4 })
    })
    expect(page1.posts.map((p) => p.postId)).toEqual(expected.slice(0, 2))
    expect(page2.posts.map((p) => p.postId)).toEqual(expected.slice(2, 4))
    expect(page3.posts.map((p) => p.postId)).toEqual(expected.slice(4, 5))
  })

  test('light aggregates: comment_count and reaction_count', async () => {
    const chapter = await makeChapter(h.sql)
    const author = await member(chapter, 'senior_instructor')
    const postId = await insertPost({ chapterId: chapter, authorMembershipId: author.membershipId })
    await h.sql`insert into comment (post_id, author_membership_id, body) values (${postId}, ${author.membershipId}, 'c1')`
    await h.sql`insert into comment (post_id, author_membership_id, body, status) values (${postId}, ${author.membershipId}, 'c2', 'hidden')`
    await h.sql`insert into reaction (target_type, target_id, membership_id, kind) values ('post', ${postId}, ${author.membershipId}, 'like')`
    const ctx = feedCtx(author.accountId, [mem('senior_instructor', chapter)])
    let result!: Awaited<ReturnType<FeedService['view']>>
    await withRequest(async () => {
      result = await svc().view(ctx, { chapterId: chapter })
    })
    const view = result.posts.find((p) => p.postId === postId)!
    expect(view.commentCount).toBe(1) // published comments only
    expect(view.reactionCount).toBe(1)
  })
})

// ===========================================================================
describe('FeedService.view — visibility', () => {
  test('hidden is excluded for an ordinary viewer and removed is never returned', async () => {
    const chapter = await makeChapter(h.sql)
    const author = await member(chapter, 'senior_instructor')
    const pub = await insertPost({ chapterId: chapter, authorMembershipId: author.membershipId, status: 'published' })
    await insertPost({ chapterId: chapter, authorMembershipId: author.membershipId, status: 'hidden' })
    await insertPost({ chapterId: chapter, authorMembershipId: author.membershipId, status: 'removed' })
    const ctx = feedCtx(author.accountId, [mem('senior_instructor', chapter)])
    let result!: Awaited<ReturnType<FeedService['view']>>
    await withRequest(async () => {
      result = await svc().view(ctx, { chapterId: chapter })
    })
    expect(result.posts.map((p) => p.postId)).toEqual([pub])
  })

  test('a moderator may include hidden via includeHidden; removed still excluded', async () => {
    const chapter = await makeChapter(h.sql)
    const author = await member(chapter, 'senior_instructor')
    const moder = await member(chapter, 'lead_instructor')
    const pub = await insertPost({ chapterId: chapter, authorMembershipId: author.membershipId, status: 'published', createdAt: '2099-04-01T00:00:00Z' })
    const hid = await insertPost({ chapterId: chapter, authorMembershipId: author.membershipId, status: 'hidden', createdAt: '2099-04-02T00:00:00Z' })
    await insertPost({ chapterId: chapter, authorMembershipId: author.membershipId, status: 'removed', createdAt: '2099-04-03T00:00:00Z' })
    const ctx = feedCtx(moder.accountId, [mem('lead_instructor', chapter)])
    let result!: Awaited<ReturnType<FeedService['view']>>
    await withRequest(async () => {
      result = await svc().view(ctx, { chapterId: chapter, includeHidden: true })
    })
    expect(new Set(result.posts.map((p) => p.postId))).toEqual(new Set([pub, hid]))
  })

  test('an ordinary viewer requesting includeHidden is denied (feed.moderate)', async () => {
    const chapter = await makeChapter(h.sql)
    const author = await member(chapter, 'senior_instructor')
    await insertPost({ chapterId: chapter, authorMembershipId: author.membershipId, status: 'hidden' })
    const student = await minorMember(chapter, 'student')
    const ctx = feedCtx(student.accountId, [mem('student', chapter)], {
      age: 13,
      consents: { platform_participation: { active: true } },
    })
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().view(ctx, { chapterId: chapter, includeHidden: true })
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
  })
})

// ===========================================================================
describe('FeedService.view — consent gate', () => {
  test('a minor WITHOUT platform_participation is denied (actor_consent_missing), no data', async () => {
    const chapter = await makeChapter(h.sql)
    const author = await member(chapter, 'senior_instructor')
    await insertPost({ chapterId: chapter, authorMembershipId: author.membershipId })
    const student = await minorMember(chapter, 'student')
    const ctx = feedCtx(student.accountId, [mem('student', chapter)], { age: 12, consents: {} })
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().view(ctx, { chapterId: chapter })
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
    const denied = await h.sql`select detail from audit_entry where action='permission.denied' and actor_account_id=${student.accountId}`
    expect(denied[0]!.detail).toMatchObject({ capability: 'feed.view', reason: 'actor_consent_missing' })
  })
})

// ===========================================================================
describe('FeedService.view — minor read logging (out-of-pod)', () => {
  test('surfacing a minor post from outside the actor pod writes exactly ONE minor_record.read', async () => {
    const chapter = await makeChapter(h.sql)
    const term = await makeTerm(h.sql, chapter)
    const podA = await makePod(h.sql, chapter, term)
    const minorAuthor = await minorMember(chapter, 'student', { podId: podA })
    // A chapter-wide instructor (no pod) reads two of the minor's pod-A posts.
    const instructor = await member(chapter, 'senior_instructor')
    await insertPost({ chapterId: chapter, podId: podA, authorMembershipId: minorAuthor.membershipId, body: 'm1' })
    await insertPost({ chapterId: chapter, podId: podA, authorMembershipId: minorAuthor.membershipId, body: 'm2' })
    const ctx = feedCtx(instructor.accountId, [mem('senior_instructor', chapter)])

    await withRequest(async () => {
      await svc().view(ctx, { chapterId: chapter })
    })
    const logs = await minorReadLogs(instructor.accountId)
    expect(logs).toHaveLength(1) // one entry per QUERY, not per post
    expect(logs[0]!.detail).toMatchObject({ granularity: 'per_query' })
    // no PII in the entry: the synthetic legal/display name never appears, and
    // neither does the minor author's account id or the post body.
    expect(JSON.stringify(logs[0]!.detail)).not.toMatch(/Testchild/)
    expect(JSON.stringify(logs[0]!.detail)).not.toContain(minorAuthor.accountId)
    expect(JSON.stringify(logs[0]!.detail)).not.toMatch(/m1|m2/)
  })

  test('an in-pod read logs nothing', async () => {
    const chapter = await makeChapter(h.sql)
    const term = await makeTerm(h.sql, chapter)
    const podA = await makePod(h.sql, chapter, term)
    const minorAuthor = await minorMember(chapter, 'student', { podId: podA })
    // A junior mentor scoped to pod A reads pod A: same pod, no log.
    const mentor = await member(chapter, 'junior_mentor', { podId: podA })
    await insertPost({ chapterId: chapter, podId: podA, authorMembershipId: minorAuthor.membershipId, body: 'm1' })
    const ctx = feedCtx(mentor.accountId, [{ ...mem('junior_mentor', chapter), pod_id: podA }])

    await withRequest(async () => {
      await svc().view(ctx, { chapterId: chapter, podId: podA })
    })
    const logs = await minorReadLogs(mentor.accountId)
    expect(logs).toHaveLength(0)
  })

  test('if the audit write fails, the read fails closed (rejects, no result)', async () => {
    const chapter = await makeChapter(h.sql)
    const term = await makeTerm(h.sql, chapter)
    const podA = await makePod(h.sql, chapter, term)
    const minorAuthor = await minorMember(chapter, 'student', { podId: podA })
    const instructor = await member(chapter, 'senior_instructor')
    await insertPost({ chapterId: chapter, podId: podA, authorMembershipId: minorAuthor.membershipId, body: 'm1' })
    const ctx = feedCtx(instructor.accountId, [mem('senior_instructor', chapter)])

    const failing = async (): Promise<string> => {
      throw new Error('audit down')
    }
    let result: unknown
    let caught: unknown
    await withRequest(async () => {
      try {
        result = await svc(undefined, failing).view(ctx, { chapterId: chapter })
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Error)
    expect(result).toBeUndefined()
    // and no partial audit row was committed
    const logs = await minorReadLogs(instructor.accountId)
    expect(logs).toHaveLength(0)
  })
})
