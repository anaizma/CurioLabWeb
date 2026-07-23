// -------------------------------------------------------------------------
// Milestone 2.2 — PostService, CommentService, ReactionService (The Lab feed).
//
// Test-first (RED before GREEN). Every write is gated through the injected
// `authorize` (03-authorization.md), under the `assertAuthorized()` backstop
// (07-test-plan.md), with the post/comment lifecycle validated by `canTransition`
// (04-state-machines.md `published -> hidden -> removed`; removed blanks the body
// and retains the row, terminal). Embedded Postgres, synthetic data only.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Forbidden, authorize, withRequest } from '@curiolab/runtime'
import type { AuthContext, ConsentSet, Membership } from '@curiolab/core'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMembership, makeMinor, makePod, makeTerm } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import {
  PostService,
  CommentService,
  ReactionService,
  type CreatePostInput,
  PostMilestoneForbiddenError,
  PostNotFoundError,
  CommentNotFoundError,
  IllegalFeedContentTransitionError,
  type FeedAuthorizeFn,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

// --- ctx builders ----------------------------------------------------------

/** A ctx for `accountId` with the given memberships, age, and own-consents. */
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

/** A real account plus an active membership of `role` in `chapter` (+ pod). */
async function member(
  chapter: string,
  role: string,
  opts: { podId?: string | null } = {},
): Promise<{ accountId: string; membershipId: string }> {
  // A `student` membership going active trips the decision-4 DOB trigger unless
  // the account carries enrollment_record provenance (makeMinor); other roles
  // use a plain adult account.
  const accountId = role === 'student' ? await makeMinor(h.sql) : await makeAdult(h.sql)
  const membershipId = await makeMembership(h.sql, accountId, chapter, {
    role,
    status: 'active',
    podId: opts.podId ?? null,
  })
  return { accountId, membershipId }
}

function posts(authorizeFn = authorize as unknown as FeedAuthorizeFn): PostService {
  return new PostService({ sql: h.sql, authorize: authorizeFn })
}
function comments(authorizeFn = authorize as unknown as FeedAuthorizeFn): CommentService {
  return new CommentService({ sql: h.sql, authorize: authorizeFn })
}
function reactions(authorizeFn = authorize as unknown as FeedAuthorizeFn): ReactionService {
  return new ReactionService({ sql: h.sql, authorize: authorizeFn })
}

/** A published post authored by a fresh chapter-scoped instructor. */
async function seedPost(
  chapter: string,
  overrides: { type?: CreatePostInput['type']; body?: string } = {},
): Promise<{ postId: string; authorId: string; authorMembershipId: string }> {
  const author = await member(chapter, 'senior_instructor')
  const ctx = feedCtx(author.accountId, [mem('senior_instructor', chapter)])
  let postId!: string
  await withRequest(async () => {
    const r = await posts().create(
      { chapterId: chapter, type: overrides.type ?? 'wip', body: overrides.body ?? 'Hello Lab' },
      ctx,
    )
    postId = r.postId
  })
  return { postId, authorId: author.accountId, authorMembershipId: author.membershipId }
}

async function postRow(postId: string) {
  const [row] = await h.sql`select status, body, chapter_id, pod_id, author_membership_id, system_generated from post where id = ${postId}`
  return row
}
async function commentRow(commentId: string) {
  const [row] = await h.sql`select status, body, post_id, author_membership_id from comment where id = ${commentId}`
  return row
}

// ===========================================================================
describe('PostService.create', () => {
  test('a consented member creates a published wip post authored by their in-scope membership', async () => {
    const chapter = await makeChapter(h.sql)
    const a = await member(chapter, 'senior_instructor')
    const ctx = feedCtx(a.accountId, [mem('senior_instructor', chapter)])

    let result!: Awaited<ReturnType<PostService['create']>>
    await withRequest(async () => {
      result = await posts().create({ chapterId: chapter, type: 'wip', body: 'My first WIP' }, ctx)
    })

    expect(result.status).toBe('published')
    expect(result.authorMembershipId).toBe(a.membershipId)
    const row = await postRow(result.postId)
    expect(row!.status).toBe('published')
    expect(row!.system_generated).toBe(false)
    expect(row!.chapter_id).toBe(chapter)
    expect(row!.pod_id).toBeNull()
    expect(row!.author_membership_id).toBe(a.membershipId)
    expect(row!.body).toBe('My first WIP')
  })

  test('a pod-scoped post carries the pod_id', async () => {
    const chapter = await makeChapter(h.sql)
    const term = await makeTerm(h.sql, chapter)
    const pod = await makePod(h.sql, chapter, term)
    const a = await member(chapter, 'junior_mentor', { podId: pod })
    const ctx = feedCtx(a.accountId, [{ ...mem('junior_mentor', chapter), pod_id: pod }])

    let postId!: string
    await withRequest(async () => {
      postId = (await posts().create({ chapterId: chapter, podId: pod, type: 'session_recap', body: 'recap' }, ctx)).postId
    })
    const row = await postRow(postId)
    expect(row!.pod_id).toBe(pod)
  })

  test('a minor WITH platform_participation may post', async () => {
    const chapter = await makeChapter(h.sql)
    const a = await member(chapter, 'student')
    const ctx = feedCtx(a.accountId, [mem('student', chapter)], {
      age: 13,
      consents: { platform_participation: { active: true } },
    })
    let ok = false
    await withRequest(async () => {
      await posts().create({ chapterId: chapter, type: 'question', body: 'help?' }, ctx)
      ok = true
    })
    expect(ok).toBe(true)
  })

  test('a minor WITHOUT platform_participation is denied (actor_consent_missing), no row', async () => {
    const chapter = await makeChapter(h.sql)
    const a = await member(chapter, 'student')
    const ctx = feedCtx(a.accountId, [mem('student', chapter)], { age: 13, consents: {} })

    let caught: unknown
    await withRequest(async () => {
      try {
        await posts().create({ chapterId: chapter, type: 'question', body: 'help?' }, ctx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
    expect(JSON.stringify(caught)).not.toMatch(/actor_consent_missing/)
    const denied = await h.sql`select detail from audit_entry where action='permission.denied' and actor_account_id=${a.accountId}`
    expect(denied).toHaveLength(1)
    expect(denied[0]!.detail).toMatchObject({ capability: 'feed.post', reason: 'actor_consent_missing' })
    const [c] = await h.sql`select count(*)::int as n from post where chapter_id=${chapter}`
    expect(c!.n).toBe(0)
  })

  test('creating a milestone-type post is rejected (system path only), no authorize, no row', async () => {
    const chapter = await makeChapter(h.sql)
    const a = await member(chapter, 'chapter_director')
    const ctx = feedCtx(a.accountId, [mem('chapter_director', chapter)])
    let caught: unknown
    await withRequest(async () => {
      try {
        await posts().create({ chapterId: chapter, type: 'milestone', body: 'x' }, ctx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(PostMilestoneForbiddenError)
    const [c] = await h.sql`select count(*)::int as n from post where chapter_id=${chapter}`
    expect(c!.n).toBe(0)
  })

  test('creating a system_generated post is rejected', async () => {
    const chapter = await makeChapter(h.sql)
    const a = await member(chapter, 'chapter_director')
    const ctx = feedCtx(a.accountId, [mem('chapter_director', chapter)])
    let caught: unknown
    await withRequest(async () => {
      try {
        await posts().create({ chapterId: chapter, type: 'wip', body: 'x', systemGenerated: true }, ctx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(PostMilestoneForbiddenError)
  })
})

// ===========================================================================
describe('PostService.edit (own)', () => {
  test('the author edits their own post body', async () => {
    const chapter = await makeChapter(h.sql)
    const author = await member(chapter, 'senior_instructor')
    const ctx = feedCtx(author.accountId, [mem('senior_instructor', chapter)])
    let postId!: string
    await withRequest(async () => {
      postId = (await posts().create({ chapterId: chapter, type: 'wip', body: 'draft' }, ctx)).postId
    })
    await withRequest(async () => {
      await posts().edit(postId, 'revised', ctx)
    })
    expect((await postRow(postId))!.body).toBe('revised')
  })

  test('a non-author participant cannot edit: Forbidden + a permission.denied row', async () => {
    const chapter = await makeChapter(h.sql)
    const { postId } = await seedPost(chapter)
    const other = await member(chapter, 'senior_instructor')
    const ctx = feedCtx(other.accountId, [mem('senior_instructor', chapter)])
    let caught: unknown
    await withRequest(async () => {
      try {
        await posts().edit(postId, 'hijack', ctx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
    const denied = await h.sql`select detail from audit_entry where action='permission.denied' and actor_account_id=${other.accountId}`
    expect(denied.length).toBeGreaterThanOrEqual(1)
    expect((await postRow(postId))!.body).toBe('Hello Lab')
  })
})

// ===========================================================================
describe('PostService lifecycle (feed.moderate)', () => {
  test('hide then unhide toggles published <-> hidden', async () => {
    const chapter = await makeChapter(h.sql)
    const { postId } = await seedPost(chapter)
    const modr = await member(chapter, 'lead_instructor')
    const ctx = feedCtx(modr.accountId, [mem('lead_instructor', chapter)])

    await withRequest(async () => {
      await posts().hide(postId, ctx)
    })
    expect((await postRow(postId))!.status).toBe('hidden')

    await withRequest(async () => {
      await posts().unhide(postId, ctx)
    })
    expect((await postRow(postId))!.status).toBe('published')
  })

  test('remove blanks the body and retains the row; removed is terminal', async () => {
    const chapter = await makeChapter(h.sql)
    const { postId } = await seedPost(chapter, { body: 'to be removed' })
    const modr = await member(chapter, 'chapter_director')
    const ctx = feedCtx(modr.accountId, [mem('chapter_director', chapter)])

    await withRequest(async () => {
      await posts().remove(postId, ctx)
    })
    const row = await postRow(postId)
    expect(row!.status).toBe('removed')
    expect(row!.body).toBe('')
    // row retained
    const [c] = await h.sql`select count(*)::int as n from post where id=${postId}`
    expect(c!.n).toBe(1)

    // a transition out of removed is rejected (terminal)
    let caught: unknown
    await withRequest(async () => {
      try {
        await posts().hide(postId, ctx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(IllegalFeedContentTransitionError)
    expect((caught as IllegalFeedContentTransitionError).reason).toBe('terminal_state')
  })

  test('unhide of a published post is an illegal transition', async () => {
    const chapter = await makeChapter(h.sql)
    const { postId } = await seedPost(chapter)
    const modr = await member(chapter, 'lead_instructor')
    const ctx = feedCtx(modr.accountId, [mem('lead_instructor', chapter)])
    let caught: unknown
    await withRequest(async () => {
      try {
        await posts().unhide(postId, ctx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(IllegalFeedContentTransitionError)
    expect((caught as IllegalFeedContentTransitionError).reason).toBe('illegal_transition')
  })

  test('hide of an unknown post throws PostNotFoundError', async () => {
    const chapter = await makeChapter(h.sql)
    const modr = await member(chapter, 'lead_instructor')
    const ctx = feedCtx(modr.accountId, [mem('lead_instructor', chapter)])
    await withRequest(async () => {
      await expect(posts().hide(randomUUID(), ctx)).rejects.toBeInstanceOf(PostNotFoundError)
    })
  })
})

// ===========================================================================
describe('CommentService', () => {
  test('a member comments on a post; the comment is published', async () => {
    const chapter = await makeChapter(h.sql)
    const { postId } = await seedPost(chapter)
    const a = await member(chapter, 'student')
    const ctx = feedCtx(a.accountId, [mem('student', chapter)])
    let result!: Awaited<ReturnType<CommentService['create']>>
    await withRequest(async () => {
      result = await comments().create(postId, { body: 'nice work' }, ctx)
    })
    expect(result.status).toBe('published')
    const row = await commentRow(result.commentId)
    expect(row!.post_id).toBe(postId)
    expect(row!.author_membership_id).toBe(a.membershipId)
    expect(row!.body).toBe('nice work')
  })

  test('a minor WITHOUT platform_participation cannot comment (actor_consent_missing)', async () => {
    const chapter = await makeChapter(h.sql)
    const { postId } = await seedPost(chapter)
    const a = await member(chapter, 'student')
    const ctx = feedCtx(a.accountId, [mem('student', chapter)], { age: 12, consents: {} })
    let caught: unknown
    await withRequest(async () => {
      try {
        await comments().create(postId, { body: 'x' }, ctx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
    const denied = await h.sql`select detail from audit_entry where action='permission.denied' and actor_account_id=${a.accountId}`
    expect(denied[0]!.detail).toMatchObject({ capability: 'feed.comment', reason: 'actor_consent_missing' })
  })

  test('an alumni cannot comment (role_not_permitted)', async () => {
    const chapter = await makeChapter(h.sql)
    const { postId } = await seedPost(chapter)
    const a = await member(chapter, 'alumni')
    const ctx = feedCtx(a.accountId, [mem('alumni', chapter)])
    let caught: unknown
    await withRequest(async () => {
      try {
        await comments().create(postId, { body: 'x' }, ctx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
    const denied = await h.sql`select detail from audit_entry where action='permission.denied' and actor_account_id=${a.accountId}`
    expect(denied[0]!.detail).toMatchObject({ capability: 'feed.comment', reason: 'role_not_permitted' })
    const [c] = await h.sql`select count(*)::int as n from comment where post_id=${postId}`
    expect(c!.n).toBe(0)
  })

  test('comment lifecycle: hide/unhide and remove blanks the body, terminal', async () => {
    const chapter = await makeChapter(h.sql)
    const { postId } = await seedPost(chapter)
    const a = await member(chapter, 'student')
    const authorCtx = feedCtx(a.accountId, [mem('student', chapter)])
    let commentId!: string
    await withRequest(async () => {
      commentId = (await comments().create(postId, { body: 'to moderate' }, authorCtx)).commentId
    })
    const modr = await member(chapter, 'lead_instructor')
    const ctx = feedCtx(modr.accountId, [mem('lead_instructor', chapter)])

    await withRequest(async () => {
      await comments().hide(commentId, ctx)
    })
    expect((await commentRow(commentId))!.status).toBe('hidden')
    await withRequest(async () => {
      await comments().unhide(commentId, ctx)
    })
    expect((await commentRow(commentId))!.status).toBe('published')
    await withRequest(async () => {
      await comments().remove(commentId, ctx)
    })
    const row = await commentRow(commentId)
    expect(row!.status).toBe('removed')
    expect(row!.body).toBe('')

    let caught: unknown
    await withRequest(async () => {
      try {
        await comments().unhide(commentId, ctx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(IllegalFeedContentTransitionError)
    expect((caught as IllegalFeedContentTransitionError).reason).toBe('terminal_state')
  })

  test('comment on an unknown post throws PostNotFoundError', async () => {
    const chapter = await makeChapter(h.sql)
    const a = await member(chapter, 'student')
    const ctx = feedCtx(a.accountId, [mem('student', chapter)])
    await withRequest(async () => {
      await expect(comments().create(randomUUID(), { body: 'x' }, ctx)).rejects.toBeInstanceOf(PostNotFoundError)
    })
  })
})

// ===========================================================================
describe('ReactionService', () => {
  test('a member reacts to a post; the row carries their membership', async () => {
    const chapter = await makeChapter(h.sql)
    const { postId } = await seedPost(chapter)
    const a = await member(chapter, 'student')
    const ctx = feedCtx(a.accountId, [mem('student', chapter)])
    await withRequest(async () => {
      await reactions().add({ type: 'post', id: postId }, 'like', ctx)
    })
    const rows = await h.sql`select membership_id, kind from reaction where target_type='post' and target_id=${postId}`
    expect(rows).toHaveLength(1)
    expect(rows[0]!.membership_id).toBe(a.membershipId)
    expect(rows[0]!.kind).toBe('like')
  })

  test('adding the same (target, member, kind) twice is idempotent — one row, no error', async () => {
    const chapter = await makeChapter(h.sql)
    const { postId } = await seedPost(chapter)
    const a = await member(chapter, 'student')
    const ctx = feedCtx(a.accountId, [mem('student', chapter)])
    await withRequest(async () => {
      await reactions().add({ type: 'post', id: postId }, 'like', ctx)
    })
    await withRequest(async () => {
      await reactions().add({ type: 'post', id: postId }, 'like', ctx)
    })
    const [c] = await h.sql`select count(*)::int as n from reaction where target_type='post' and target_id=${postId} and membership_id=${a.membershipId} and kind='like'`
    expect(c!.n).toBe(1)
  })

  test('a different kind by the same member is a new row', async () => {
    const chapter = await makeChapter(h.sql)
    const { postId } = await seedPost(chapter)
    const a = await member(chapter, 'student')
    const ctx = feedCtx(a.accountId, [mem('student', chapter)])
    await withRequest(async () => {
      await reactions().add({ type: 'post', id: postId }, 'like', ctx)
    })
    await withRequest(async () => {
      await reactions().add({ type: 'post', id: postId }, 'celebrate', ctx)
    })
    const [c] = await h.sql`select count(*)::int as n from reaction where target_type='post' and target_id=${postId} and membership_id=${a.membershipId}`
    expect(c!.n).toBe(2)
  })

  test('remove deletes the reaction', async () => {
    const chapter = await makeChapter(h.sql)
    const { postId } = await seedPost(chapter)
    const a = await member(chapter, 'student')
    const ctx = feedCtx(a.accountId, [mem('student', chapter)])
    await withRequest(async () => {
      await reactions().add({ type: 'post', id: postId }, 'like', ctx)
    })
    await withRequest(async () => {
      await reactions().remove({ type: 'post', id: postId }, 'like', ctx)
    })
    const [c] = await h.sql`select count(*)::int as n from reaction where target_type='post' and target_id=${postId} and membership_id=${a.membershipId} and kind='like'`
    expect(c!.n).toBe(0)
  })

  test('a reaction to a comment resolves the target chapter via its post', async () => {
    const chapter = await makeChapter(h.sql)
    const { postId } = await seedPost(chapter)
    const a = await member(chapter, 'student')
    const ctx = feedCtx(a.accountId, [mem('student', chapter)])
    let commentId!: string
    await withRequest(async () => {
      commentId = (await comments().create(postId, { body: 'c' }, ctx)).commentId
    })
    await withRequest(async () => {
      await reactions().add({ type: 'comment', id: commentId }, 'like', ctx)
    })
    const [c] = await h.sql`select count(*)::int as n from reaction where target_type='comment' and target_id=${commentId}`
    expect(c!.n).toBe(1)
  })

  test('a reaction to an unknown comment throws CommentNotFoundError', async () => {
    const chapter = await makeChapter(h.sql)
    const a = await member(chapter, 'student')
    const ctx = feedCtx(a.accountId, [mem('student', chapter)])
    await withRequest(async () => {
      await expect(reactions().add({ type: 'comment', id: randomUUID() }, 'like', ctx)).rejects.toBeInstanceOf(CommentNotFoundError)
    })
  })
})

// ===========================================================================
describe('authorization is enforced on every mutating method', () => {
  // A stranger: an active account with a membership only in ANOTHER chapter, so
  // every feed capability denies out_of_scope through `authorize`.
  async function strangerCtx(): Promise<{ accountId: string; ctx: AuthContext }> {
    const otherChapter = await makeChapter(h.sql)
    const accountId = await makeAdult(h.sql)
    return { accountId, ctx: feedCtx(accountId, [mem('senior_instructor', otherChapter)]) }
  }

  test('a stranger is denied with a reason-less Forbidden and a permission.denied row on each method', async () => {
    const chapter = await makeChapter(h.sql)
    const { postId } = await seedPost(chapter)
    const a = await member(chapter, 'student')
    let commentId!: string
    await withRequest(async () => {
      commentId = (await comments().create(postId, { body: 'c' }, feedCtx(a.accountId, [mem('student', chapter)]))).commentId
    })

    const ops: Array<{ name: string; run: (ctx: AuthContext) => Promise<unknown> }> = [
      { name: 'post.create', run: (ctx) => posts().create({ chapterId: chapter, type: 'wip', body: 'x' }, ctx) },
      { name: 'post.edit', run: (ctx) => posts().edit(postId, 'x', ctx) },
      { name: 'post.hide', run: (ctx) => posts().hide(postId, ctx) },
      { name: 'post.unhide', run: (ctx) => posts().unhide(postId, ctx) },
      { name: 'post.remove', run: (ctx) => posts().remove(postId, ctx) },
      { name: 'comment.create', run: (ctx) => comments().create(postId, { body: 'x' }, ctx) },
      { name: 'comment.hide', run: (ctx) => comments().hide(commentId, ctx) },
      { name: 'comment.unhide', run: (ctx) => comments().unhide(commentId, ctx) },
      { name: 'comment.remove', run: (ctx) => comments().remove(commentId, ctx) },
      { name: 'reaction.add', run: (ctx) => reactions().add({ type: 'post', id: postId }, 'like', ctx) },
      { name: 'reaction.remove', run: (ctx) => reactions().remove({ type: 'post', id: postId }, 'like', ctx) },
    ]

    for (const op of ops) {
      const { accountId, ctx } = await strangerCtx()
      let caught: unknown
      await withRequest(async () => {
        try {
          await op.run(ctx)
        } catch (e) {
          caught = e
        }
      })
      expect(caught, op.name).toBeInstanceOf(Forbidden)
      expect(JSON.stringify(caught), op.name).not.toMatch(/out_of_scope/)
      const denied = await h.sql`select count(*)::int as n from audit_entry where action='permission.denied' and actor_account_id=${accountId}`
      expect(denied[0]!.n, op.name).toBeGreaterThanOrEqual(1)
    }

    // Nothing mutated: the post is still its original published body.
    expect((await postRow(postId))!.status).toBe('published')
    expect((await postRow(postId))!.body).toBe('Hello Lab')
  })

  test('the runtime backstop holds: an authorize that allows without recording cannot mutate', async () => {
    const chapter = await makeChapter(h.sql)
    const a = await member(chapter, 'senior_instructor')
    const ctx = feedCtx(a.accountId, [mem('senior_instructor', chapter)])
    const allowWithoutRecording = (async () => undefined) as unknown as FeedAuthorizeFn

    let caught: unknown
    await withRequest(async () => {
      try {
        await posts(allowWithoutRecording).create({ chapterId: chapter, type: 'wip', body: 'x' }, ctx)
      } catch (e) {
        caught = e
      }
    })
    expect((caught as Error).message).toMatch(/no authorization decision recorded/)
    const [c] = await h.sql`select count(*)::int as n from post where chapter_id=${chapter}`
    expect(c!.n).toBe(0)
  })
})
