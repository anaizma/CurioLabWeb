// -------------------------------------------------------------------------
// Milestone 2.4 — ModerationService + the feed.hide_safety path (The Lab).
//
// Test-first (RED before GREEN). Every gated method runs through the injected
// `authorize` (03-authorization.md) under the `assertAuthorized()` backstop, with
// the moderation_report lifecycle validated by `canTransition('moderation_report',
// ...)` (04-state-machines.md: filed -> acknowledged -> resolved; escalated
// reachable from any pre-resolution state). Embedded Postgres, synthetic data.
// -------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Forbidden, authorize, withRequest } from '@curiolab/runtime'
import type { AuthContext, ConsentSet, Membership } from '@curiolab/core'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMembership, makeMinor, makePod, makeTerm } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import {
  ModerationService,
  PostService,
  CommentService,
  sweepOverdueReports,
  ModerationReportNotFoundError,
  IllegalModerationTransitionError,
  type FeedAuthorizeFn,
  type ModerationAuthorizeFn,
  type ModerationNotification,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

// --- ctx / service builders ------------------------------------------------

function modCtx(
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

function moderation(
  authorizeFn = authorize as unknown as ModerationAuthorizeFn,
  notifier?: (e: ModerationNotification) => void,
): ModerationService {
  return new ModerationService({ sql: h.sql, authorize: authorizeFn, notifier })
}
function posts(authorizeFn = authorize as unknown as FeedAuthorizeFn): PostService {
  return new PostService({ sql: h.sql, authorize: authorizeFn })
}
function comments(authorizeFn = authorize as unknown as FeedAuthorizeFn): CommentService {
  return new CommentService({ sql: h.sql, authorize: authorizeFn })
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

/** A published post authored by a fresh chapter instructor, optionally in a pod. */
async function seedPost(
  chapter: string,
  opts: { podId?: string | null } = {},
): Promise<string> {
  const author = await member(chapter, 'senior_instructor')
  const [row] = await h.sql`
    insert into post (chapter_id, pod_id, author_membership_id, type, body)
    values (${chapter}, ${opts.podId ?? null}, ${author.membershipId}, 'wip', 'Hello Lab')
    returning id
  `
  return row!.id as string
}

async function reportRow(reportId: string) {
  const [row] = await h.sql`select * from moderation_report where id = ${reportId}`
  return row
}

/** Insert a report directly (for lifecycle/sweep tests needing a chosen filed_at). */
async function insertReport(
  chapter: string,
  reporter: string,
  opts: { class?: 'safety' | 'ordinary'; filedAt?: string; resolvedAt?: string | null } = {},
): Promise<string> {
  const [row] = await h.sql`
    insert into moderation_report (
      target_type, target_id, reporter_account_id, chapter_id, class, reason, filed_at, resolved_at
    ) values (
      'post', ${randomUUID()}, ${reporter}, ${chapter}, ${opts.class ?? 'ordinary'}, 'harmful',
      ${opts.filedAt ?? h.sql`now()`}, ${opts.resolvedAt ?? null}
    ) returning id
  `
  return row!.id as string
}

// ===========================================================================
describe('ModerationService.fileReport (feed.report)', () => {
  test('a member files a filed report with the given class and reason', async () => {
    const chapter = await makeChapter(h.sql)
    const postId = await seedPost(chapter)
    const reporter = await member(chapter, 'student')
    const ctx = modCtx(reporter.accountId, [mem('student', chapter)], {
      age: 14,
      consents: { platform_participation: { active: true } },
    })

    let result!: Awaited<ReturnType<ModerationService['fileReport']>>
    await withRequest(async () => {
      result = await moderation().fileReport(
        { target: { type: 'post', id: postId }, class: 'ordinary', reason: 'unkind' },
        ctx,
      )
    })
    expect(result.status).toBe('filed')
    const row = await reportRow(result.reportId)
    expect(row!.class).toBe('ordinary')
    expect(row!.reason).toBe('unkind')
    expect(row!.reporter_account_id).toBe(reporter.accountId)
    expect(row!.chapter_id).toBe(chapter)
    expect(row!.target_type).toBe('post')
    expect(row!.target_id).toBe(postId)
    expect(row!.acknowledged_at).toBeNull()
  })

  test('a safety report fires the (documented) escalation notification seam', async () => {
    const chapter = await makeChapter(h.sql)
    const postId = await seedPost(chapter)
    const reporter = await member(chapter, 'senior_instructor')
    const ctx = modCtx(reporter.accountId, [mem('senior_instructor', chapter)])

    const seen: ModerationNotification[] = []
    await withRequest(async () => {
      await moderation(undefined, (e) => seen.push(e)).fileReport(
        { target: { type: 'post', id: postId }, class: 'safety', reason: 'threatening' },
        ctx,
      )
    })
    expect(seen.some((e) => e.kind === 'safety_report_filed')).toBe(true)
  })

  test('a report on a comment resolves the chapter via its post', async () => {
    const chapter = await makeChapter(h.sql)
    const postId = await seedPost(chapter)
    const author = await member(chapter, 'senior_instructor')
    const [c] = await h.sql`
      insert into comment (post_id, author_membership_id, body) values (${postId}, ${author.membershipId}, 'c') returning id
    `
    const commentId = c!.id as string
    const reporter = await member(chapter, 'senior_instructor')
    const ctx = modCtx(reporter.accountId, [mem('senior_instructor', chapter)])
    let reportId!: string
    await withRequest(async () => {
      reportId = (
        await moderation().fileReport(
          { target: { type: 'comment', id: commentId }, class: 'ordinary', reason: 'spam' },
          ctx,
        )
      ).reportId
    })
    const row = await reportRow(reportId)
    expect(row!.target_type).toBe('comment')
    expect(row!.chapter_id).toBe(chapter)
  })
})

// ===========================================================================
describe('ModerationService lifecycle: filed -> acknowledged -> resolved', () => {
  test('acknowledge sets acknowledged_at; resolve sets resolved_at + action + resolver', async () => {
    const chapter = await makeChapter(h.sql)
    const reporter = await member(chapter, 'senior_instructor')
    const reportId = await insertReport(chapter, reporter.accountId, { class: 'ordinary' })

    const modr = await member(chapter, 'chapter_director')
    const ctx = modCtx(modr.accountId, [mem('chapter_director', chapter)])

    await withRequest(async () => {
      await moderation().acknowledge(reportId, ctx)
    })
    expect((await reportRow(reportId))!.acknowledged_at).not.toBeNull()

    let res!: Awaited<ReturnType<ModerationService['resolve']>>
    await withRequest(async () => {
      res = await moderation().resolve(reportId, ctx, 'dismissed')
    })
    expect(res.status).toBe('resolved')
    const row = await reportRow(reportId)
    expect(row!.resolved_at).not.toBeNull()
    expect(row!.action_taken).toBe('dismissed')
    expect(row!.resolver_account_id).toBe(modr.accountId)
    expect(row!.resolver_membership_id).toBe(modr.membershipId)
  })

  test('resolve of a still-filed (unacknowledged) report is an illegal transition', async () => {
    const chapter = await makeChapter(h.sql)
    const reporter = await member(chapter, 'senior_instructor')
    const reportId = await insertReport(chapter, reporter.accountId)
    const modr = await member(chapter, 'lead_instructor')
    const ctx = modCtx(modr.accountId, [mem('lead_instructor', chapter)])
    let caught: unknown
    await withRequest(async () => {
      try {
        await moderation().resolve(reportId, ctx, 'none')
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(IllegalModerationTransitionError)
  })

  test('escalated is reachable from a pre-resolution state, and is then resolvable', async () => {
    const chapter = await makeChapter(h.sql)
    const reporter = await member(chapter, 'senior_instructor')
    const reportId = await insertReport(chapter, reporter.accountId, { class: 'ordinary' })
    const modr = await member(chapter, 'chapter_director')
    const ctx = modCtx(modr.accountId, [mem('chapter_director', chapter)])

    await withRequest(async () => {
      await moderation().escalate(reportId, ctx)
    })
    expect((await reportRow(reportId))!.escalated_at).not.toBeNull()

    // An escalated report is still resolvable.
    await withRequest(async () => {
      await moderation().resolve(reportId, ctx, 'removed')
    })
    expect((await reportRow(reportId))!.resolved_at).not.toBeNull()
  })

  test('acknowledge/resolve of an unknown report throws ModerationReportNotFoundError', async () => {
    const chapter = await makeChapter(h.sql)
    const modr = await member(chapter, 'chapter_director')
    const ctx = modCtx(modr.accountId, [mem('chapter_director', chapter)])
    await withRequest(async () => {
      await expect(moderation().acknowledge(randomUUID(), ctx)).rejects.toBeInstanceOf(
        ModerationReportNotFoundError,
      )
    })
  })
})

// ===========================================================================
describe('moderation.resolve carries the adult actor condition', () => {
  test('a minor mentor is denied (actor_condition_failed); an adult director is allowed', async () => {
    const chapter = await makeChapter(h.sql)
    const reporter = await member(chapter, 'senior_instructor')
    const reportId = await insertReport(chapter, reporter.accountId, { class: 'safety' })

    // Acknowledge first (legal edge to resolved), by an adult.
    const adult = await member(chapter, 'chapter_director')
    const adultCtx = modCtx(adult.accountId, [mem('chapter_director', chapter)])
    await withRequest(async () => {
      await moderation().acknowledge(reportId, adultCtx)
    })

    // A minor junior_mentor cannot resolve.
    const minor = await member(chapter, 'junior_mentor')
    const minorCtx = modCtx(minor.accountId, [mem('junior_mentor', chapter)], { age: 16 })
    let caught: unknown
    await withRequest(async () => {
      try {
        await moderation().resolve(reportId, minorCtx, 'dismissed')
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
    const denied = await h.sql`select detail from audit_entry where action='permission.denied' and actor_account_id=${minor.accountId}`
    expect(denied[0]!.detail).toMatchObject({ capability: 'moderation.resolve', reason: 'actor_condition_failed' })
    expect((await reportRow(reportId))!.resolved_at).toBeNull()

    // The adult director resolves.
    await withRequest(async () => {
      await moderation().resolve(reportId, adultCtx, 'dismissed')
    })
    expect((await reportRow(reportId))!.resolved_at).not.toBeNull()
  })
})

// ===========================================================================
describe('feed.hide_safety: hide on sight + auto-file a safety report', () => {
  test('an instructor whose pod does NOT own the post hides it and auto-files a class=safety report atomically', async () => {
    const chapter = await makeChapter(h.sql)
    const term = await makeTerm(h.sql, chapter)
    const podA = await makePod(h.sql, chapter, term)
    const podB = await makePod(h.sql, chapter, term)
    const postId = await seedPost(chapter, { podId: podA })

    // A junior_mentor assigned to podB — NOT the post's pod — may still hide it
    // (feed.hide_safety is chapter-scoped, not pod-bound).
    const mentor = await member(chapter, 'junior_mentor', { podId: podB })
    const ctx = modCtx(mentor.accountId, [{ ...mem('junior_mentor', chapter), pod_id: podB }])

    let result!: Awaited<ReturnType<PostService['hideSafety']>>
    await withRequest(async () => {
      result = await posts().hideSafety(postId, ctx)
    })
    expect(result.status).toBe('hidden')

    const [p] = await h.sql`select status from post where id = ${postId}`
    expect(p!.status).toBe('hidden')

    const reports = await h.sql`select class, reason, reporter_account_id, target_type, target_id from moderation_report where target_id = ${postId}`
    expect(reports).toHaveLength(1)
    expect(reports[0]!.class).toBe('safety')
    expect(reports[0]!.target_type).toBe('post')
    expect(reports[0]!.reporter_account_id).toBe(mentor.accountId)
    expect(result.reportId).toBeTruthy()
  })

  test('a hide_safety on a comment hides it and auto-files a safety report', async () => {
    const chapter = await makeChapter(h.sql)
    const postId = await seedPost(chapter)
    const author = await member(chapter, 'senior_instructor')
    const [c] = await h.sql`insert into comment (post_id, author_membership_id, body) values (${postId}, ${author.membershipId}, 'c') returning id`
    const commentId = c!.id as string
    const mentor = await member(chapter, 'senior_instructor')
    const ctx = modCtx(mentor.accountId, [mem('senior_instructor', chapter)])
    await withRequest(async () => {
      await comments().hideSafety(commentId, ctx)
    })
    const [cr] = await h.sql`select status from comment where id = ${commentId}`
    expect(cr!.status).toBe('hidden')
    const reports = await h.sql`select class from moderation_report where target_id = ${commentId} and target_type='comment'`
    expect(reports).toHaveLength(1)
    expect(reports[0]!.class).toBe('safety')
  })
})

// ===========================================================================
describe('sweepOverdueReports (the escalation job body)', () => {
  test('escalates only unresolved, past-due, not-yet-escalated reports; a stale safety report targets platform_admin', async () => {
    const chapter = await makeChapter(h.sql)
    const reporter = await member(chapter, 'senior_instructor')

    // A platform_admin to be the safety escalation target.
    const admin = await member(chapter, 'platform_admin')

    // (a) a stale safety report — filed 48h before `now`, so past its 24h due.
    const staleSafety = await insertReport(chapter, reporter.accountId, {
      class: 'safety',
      filedAt: '2099-01-01T00:00:00Z',
    })
    // (b) a not-yet-due ordinary report — filed just now (72h window open).
    const fresh = await insertReport(chapter, reporter.accountId, {
      class: 'ordinary',
      filedAt: '2099-01-02T23:00:00Z',
    })
    // (c) an already-resolved (but past-due) report — must be skipped.
    const resolved = await insertReport(chapter, reporter.accountId, {
      class: 'safety',
      filedAt: '2099-01-01T00:00:00Z',
      resolvedAt: '2099-01-01T02:00:00Z',
    })

    const now = new Date('2099-01-03T00:00:00Z')
    const result = await sweepOverdueReports({ sql: h.sql }, now)

    const escalatedIds = result.escalated.map((e) => e.reportId)
    expect(escalatedIds).toContain(staleSafety)
    expect(escalatedIds).not.toContain(fresh)
    expect(escalatedIds).not.toContain(resolved)

    const stale = await reportRow(staleSafety)
    expect(stale!.escalated_at).not.toBeNull()
    expect(stale!.escalated_to).toBe(admin.accountId) // safety -> platform_admin

    expect((await reportRow(fresh))!.escalated_at).toBeNull()
    expect((await reportRow(resolved))!.escalated_at).toBeNull()
  })

  test('a stale ordinary report escalates to the chapter director', async () => {
    const chapter = await makeChapter(h.sql)
    const reporter = await member(chapter, 'senior_instructor')
    const director = await member(chapter, 'chapter_director')
    const ordinaryStale = await insertReport(chapter, reporter.accountId, {
      class: 'ordinary',
      filedAt: '2099-01-01T00:00:00Z',
    })
    const now = new Date('2099-01-10T00:00:00Z')
    await sweepOverdueReports({ sql: h.sql }, now)
    expect((await reportRow(ordinaryStale))!.escalated_to).toBe(director.accountId)
  })
})

// ===========================================================================
describe('authorization is enforced on every gated moderation method', () => {
  async function strangerCtx(): Promise<{ accountId: string; ctx: AuthContext }> {
    const otherChapter = await makeChapter(h.sql)
    const accountId = await makeAdult(h.sql)
    return { accountId, ctx: modCtx(accountId, [mem('senior_instructor', otherChapter)]) }
  }

  test('a stranger is denied with a reason-less Forbidden and a permission.denied row on each method', async () => {
    const chapter = await makeChapter(h.sql)
    const postId = await seedPost(chapter)
    const reporter = await member(chapter, 'senior_instructor')
    const reportId = await insertReport(chapter, reporter.accountId)

    const ops: Array<{ name: string; run: (ctx: AuthContext) => Promise<unknown> }> = [
      {
        name: 'fileReport',
        run: (ctx) =>
          moderation().fileReport({ target: { type: 'post', id: postId }, class: 'ordinary', reason: 'spam' }, ctx),
      },
      { name: 'acknowledge', run: (ctx) => moderation().acknowledge(reportId, ctx) },
      { name: 'resolve', run: (ctx) => moderation().resolve(reportId, ctx, 'none') },
      { name: 'escalate', run: (ctx) => moderation().escalate(reportId, ctx) },
      { name: 'post.hideSafety', run: (ctx) => posts().hideSafety(postId, ctx) },
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
  })

  test('the runtime backstop holds: an authorize that allows without recording cannot mutate', async () => {
    const chapter = await makeChapter(h.sql)
    const postId = await seedPost(chapter)
    const a = await member(chapter, 'senior_instructor')
    const ctx = modCtx(a.accountId, [mem('senior_instructor', chapter)])
    const allowWithoutRecording = (async () => undefined) as unknown as ModerationAuthorizeFn

    let caught: unknown
    await withRequest(async () => {
      try {
        await moderation(allowWithoutRecording).fileReport(
          { target: { type: 'post', id: postId }, class: 'ordinary', reason: 'spam' },
          ctx,
        )
      } catch (e) {
        caught = e
      }
    })
    expect((caught as Error).message).toMatch(/no authorization decision recorded/)
    const [c] = await h.sql`select count(*)::int as n from moderation_report where chapter_id=${chapter}`
    expect(c!.n).toBe(0)
  })
})
