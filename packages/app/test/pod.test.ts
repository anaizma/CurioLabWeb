// -------------------------------------------------------------------------
// PodService tests (Platform administration; 05-api-surface CRUD /admin/pods,
// and the pod-assignment ops). A chapter_director creates a pod and assigns a
// senior instructor to it for a term (a pod_assignment row appears); a director
// of another chapter is denied (out_of_scope); unassign removes the row.
// Embedded Postgres, synthetic data only.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Forbidden, authorize, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMembership, makeTerm } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import {
  PodService,
  PodNotFoundError,
  type PodAuthorizeFn,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

function svc(authorizeFn = authorize as unknown as PodAuthorizeFn) {
  return new PodService({ sql: h.sql, authorize: authorizeFn })
}

function directorCtx(director: string, chapter: string) {
  return baseCtx(director, new Date(), [mem('chapter_director', chapter)])
}

/** A chapter + term + a senior instructor membership in that chapter. */
async function scaffold() {
  const chapter = await makeChapter(h.sql)
  const term = await makeTerm(h.sql, chapter)
  const director = await makeAdult(h.sql)
  const instructorAccount = await makeAdult(h.sql)
  const instructorMembership = await makeMembership(h.sql, instructorAccount, chapter, {
    role: 'senior_instructor',
  })
  return { chapter, term, director, instructorMembership }
}

// ===========================================================================
describe('PodService.create', () => {
  test('a director creates a pod in their chapter (no mentor)', async () => {
    const f = await scaffold()
    const ctx = directorCtx(f.director, f.chapter)
    let result!: Awaited<ReturnType<PodService['create']>>
    await withRequest(async () => {
      result = await svc().create(f.chapter, { termId: f.term, name: 'Pod Alpha' }, ctx)
    })
    expect(result).toMatchObject({ chapterId: f.chapter, termId: f.term, name: 'Pod Alpha' })
    const [row] = await h.sql`select chapter_id, term_id, name, mentor_membership_id from pod where id = ${result.podId}`
    expect(row!.chapter_id).toBe(f.chapter)
    expect(row!.mentor_membership_id).toBeNull()
  })

  test('a director creates a pod with a mentor membership', async () => {
    const f = await scaffold()
    const ctx = directorCtx(f.director, f.chapter)
    let result!: Awaited<ReturnType<PodService['create']>>
    await withRequest(async () => {
      result = await svc().create(
        f.chapter,
        { termId: f.term, name: 'Pod Beta', mentorMembershipId: f.instructorMembership },
        ctx,
      )
    })
    const [row] = await h.sql`select mentor_membership_id from pod where id = ${result.podId}`
    expect(row!.mentor_membership_id).toBe(f.instructorMembership)
  })

  test('a director of another chapter is denied (out_of_scope), no pod created', async () => {
    const f = await scaffold()
    const otherChapter = await makeChapter(h.sql)
    const intruder = await makeAdult(h.sql)
    const ctx = directorCtx(intruder, otherChapter)
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().create(f.chapter, { termId: f.term, name: 'Nope' }, ctx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
    const rows = await h.sql`select id from pod where chapter_id = ${f.chapter}`
    expect(rows).toHaveLength(0)
    const denied = await h.sql`
      select detail from audit_entry
      where action = 'permission.denied' and actor_account_id = ${intruder}
        and detail->>'capability' = 'pod.manage'
    `
    expect(denied).toHaveLength(1)
  })
})

// ===========================================================================
describe('PodService.assign / unassign', () => {
  async function podFor(f: Awaited<ReturnType<typeof scaffold>>, ctx = directorCtx(f.director, f.chapter)) {
    let podId!: string
    await withRequest(async () => {
      podId = (await svc().create(f.chapter, { termId: f.term, name: 'Pod Alpha' }, ctx)).podId
    })
    return podId
  }

  test('a director assigns a senior instructor to a pod for a term (a pod_assignment row appears)', async () => {
    const f = await scaffold()
    const ctx = directorCtx(f.director, f.chapter)
    const podId = await podFor(f, ctx)

    let result!: Awaited<ReturnType<PodService['assign']>>
    await withRequest(async () => {
      result = await svc().assign(podId, f.instructorMembership, f.term, ctx)
    })
    expect(result).toMatchObject({ podId, membershipId: f.instructorMembership, termId: f.term })

    const rows = await h.sql`
      select id from pod_assignment
      where pod_id = ${podId} and membership_id = ${f.instructorMembership} and term_id = ${f.term}
    `
    expect(rows).toHaveLength(1)
  })

  test('unassign removes the pod_assignment row', async () => {
    const f = await scaffold()
    const ctx = directorCtx(f.director, f.chapter)
    const podId = await podFor(f, ctx)
    await withRequest(async () => {
      await svc().assign(podId, f.instructorMembership, f.term, ctx)
    })

    await withRequest(async () => {
      await svc().unassign(podId, f.instructorMembership, f.term, ctx)
    })
    const rows = await h.sql`
      select id from pod_assignment
      where pod_id = ${podId} and membership_id = ${f.instructorMembership} and term_id = ${f.term}
    `
    expect(rows).toHaveLength(0)
  })

  test('a director of another chapter cannot assign into this pod (out_of_scope), no row appears', async () => {
    const f = await scaffold()
    const podId = await podFor(f)

    const otherChapter = await makeChapter(h.sql)
    const intruder = await makeAdult(h.sql)
    const intruderCtx = directorCtx(intruder, otherChapter)
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().assign(podId, f.instructorMembership, f.term, intruderCtx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
    const rows = await h.sql`select id from pod_assignment where pod_id = ${podId}`
    expect(rows).toHaveLength(0)
  })

  test('assigning into an unknown pod is a PodNotFoundError', async () => {
    const f = await scaffold()
    const ctx = directorCtx(f.director, f.chapter)
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().assign(randomUUID(), f.instructorMembership, f.term, ctx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(PodNotFoundError)
  })
})
