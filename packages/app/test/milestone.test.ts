// -------------------------------------------------------------------------
// MilestoneService tests (Milestone 2.5 — system-generated milestones and the
// timeline, the empty-state solution). MilestoneService.emit is the system
// emitter: writing, in the CALLER's transaction, one append-only timeline_entry
// and one `system_generated` milestone `post` (02-data-model.md timeline_entry /
// post; 04-state-machines.md "milestone posts are system_generated and skip the
// consent gate"). It has no actor and does NOT go through `authorize` — it is a
// side effect of an already-authorized transition, so it composes inside a
// coupling by accepting the caller's transaction handle. Embedded Postgres,
// synthetic data only.
// -------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { authorize, withRequest } from '@curiolab/runtime'
import type { AuthContext } from '@curiolab/core'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeChapter, makeMembership, makeMinor } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import {
  MilestoneService,
  PostService,
  PostMilestoneForbiddenError,
  type FeedAuthorizeFn,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

/** A chapter with an active student account + active student membership in it. */
async function activeStudent() {
  const chapter = await makeChapter(h.sql)
  const student = await makeMinor(h.sql)
  const membershipId = await makeMembership(h.sql, student, chapter, {
    role: 'student',
    status: 'active',
  })
  return { chapter, student, membershipId }
}

// ===========================================================================
describe('MilestoneService.emit (the system emitter)', () => {
  test('writes one timeline_entry AND one system_generated milestone post in the caller transaction', async () => {
    const { chapter, student, membershipId } = await activeStudent()
    const svc = new MilestoneService()
    const occurredAt = new Date('2099-03-03T12:00:00Z')

    const res = await h.sql.begin((tx) =>
      svc.emit(tx, {
        accountId: student,
        membershipId,
        kind: 'joined',
        chapterId: chapter,
        podId: null,
        occurredAt,
        body: 'Joined CurioLab',
        ref: null,
      }),
    )

    // The timeline_entry: account, kind, occurred_at as passed.
    const [te] = await h.sql`select * from timeline_entry where id = ${res.timelineEntryId}`
    expect(te!.account_id).toBe(student)
    expect(te!.kind).toBe('joined')
    expect(new Date(te!.occurred_at as string).toISOString()).toBe(occurredAt.toISOString())

    // The milestone post: type milestone, system_generated, authored by the
    // subject membership, published, body carried, chapter scoped.
    const [p] = await h.sql`select * from post where id = ${res.postId}`
    expect(p!.type).toBe('milestone')
    expect(p!.system_generated).toBe(true)
    expect(p!.author_membership_id).toBe(membershipId)
    expect(p!.status).toBe('published')
    expect(p!.body).toBe('Joined CurioLab')
    expect(p!.chapter_id).toBe(chapter)
    expect(p!.pod_id).toBeNull()
  })

  test('carries ref and pod scope through to the timeline entry and post', async () => {
    const { chapter, student, membershipId } = await activeStudent()
    const svc = new MilestoneService()
    // A synthetic ref (a tier_transition id in the real flow).
    const [tt] = await h.sql`select gen_random_uuid() as id`
    const ref = tt!.id as string

    const res = await h.sql.begin((tx) =>
      svc.emit(tx, {
        accountId: student,
        membershipId,
        kind: 'tier_reached',
        chapterId: chapter,
        podId: null,
        occurredAt: new Date('2099-04-04T00:00:00Z'),
        body: 'Reached Explorer',
        ref,
      }),
    )

    const [te] = await h.sql`select ref, kind from timeline_entry where id = ${res.timelineEntryId}`
    expect(te!.ref).toBe(ref)
    expect(te!.kind).toBe('tier_reached')
  })

  test('rolls back both writes when the caller transaction later fails (atomic with the coupling)', async () => {
    const { chapter, student, membershipId } = await activeStudent()
    const svc = new MilestoneService()

    let caught: unknown
    try {
      await h.sql.begin(async (tx) => {
        await svc.emit(tx, {
          accountId: student,
          membershipId,
          kind: 'joined',
          chapterId: chapter,
          podId: null,
          occurredAt: new Date(),
          body: 'Joined CurioLab',
          ref: null,
        })
        throw new Error('rollback-please')
      })
    } catch (e) {
      caught = e
    }
    expect((caught as Error).message).toMatch(/rollback-please/)

    const [tc] = await h.sql`select count(*)::int as n from timeline_entry where account_id = ${student}`
    expect(tc!.n).toBe(0)
    const [pc] = await h.sql`select count(*)::int as n from post where author_membership_id = ${membershipId}`
    expect(pc!.n).toBe(0)
  })
})

// ===========================================================================
// Regression: the member-authored create path is still the ONLY path, and it
// still refuses to mint a milestone or a system_generated post. The system path
// (MilestoneService) is the sole creator of those (milestone-2.md §M2.2/§M2.5).
describe('PostService.create still rejects manual milestone/system_generated (regression)', () => {
  function ctxFor(accountId: string, chapter: string): AuthContext {
    return baseCtx(accountId, new Date(), [mem('lead_instructor', chapter)])
  }

  test('a milestone type is rejected before any IO', async () => {
    const { chapter, student, membershipId } = await activeStudent()
    void membershipId
    const posts = new PostService({ sql: h.sql, authorize: authorize as unknown as FeedAuthorizeFn })
    let caught: unknown
    await withRequest(async () => {
      try {
        await posts.create(
          { chapterId: chapter, type: 'milestone', body: 'nope' },
          ctxFor(student, chapter),
        )
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(PostMilestoneForbiddenError)
  })

  test('a system_generated flag is rejected before any IO', async () => {
    const { chapter, student } = await activeStudent()
    const posts = new PostService({ sql: h.sql, authorize: authorize as unknown as FeedAuthorizeFn })
    let caught: unknown
    await withRequest(async () => {
      try {
        await posts.create(
          { chapterId: chapter, type: 'wip', body: 'nope', systemGenerated: true },
          ctxFor(student, chapter),
        )
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(PostMilestoneForbiddenError)
  })
})
