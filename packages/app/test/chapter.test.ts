// -------------------------------------------------------------------------
// ChapterService tests (Platform administration; 05-api-surface CRUD
// /admin/chapters). A platform_admin stands up and reconfigures a chapter; a
// chapter_director is denied (chapter.manage is platform-scoped). Embedded
// Postgres, synthetic data only.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Forbidden, authorize, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import {
  ChapterService,
  ChapterNotFoundError,
  type ChapterAuthorizeFn,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

function svc(authorizeFn = authorize as unknown as ChapterAuthorizeFn) {
  return new ChapterService({ sql: h.sql, authorize: authorizeFn })
}

/** A platform_admin AuthContext backed by a real account. */
async function adminCtx() {
  const admin = await makeAdult(h.sql)
  return { admin, ctx: baseCtx(admin, new Date(), [mem('platform_admin', 'platform')]) }
}

function uniqueSlug() {
  return `chapter-${randomUUID().slice(0, 8)}`
}

// ===========================================================================
describe('ChapterService.create', () => {
  test('a platform_admin creates a chapter (default status prospective)', async () => {
    const { ctx } = await adminCtx()
    const slug = uniqueSlug()
    let result!: Awaited<ReturnType<ChapterService['create']>>
    await withRequest(async () => {
      result = await svc().create(
        { name: 'Synthetic Test Chapter', slug, tier: 'seed', timezone: 'America/New_York' },
        ctx,
      )
    })
    expect(result.chapterId).toBeTruthy()
    expect(result.status).toBe('prospective')

    const [row] = await h.sql`select name, slug, tier, status, timezone from chapter where id = ${result.chapterId}`
    expect(row).toMatchObject({
      name: 'Synthetic Test Chapter',
      slug,
      tier: 'seed',
      status: 'prospective',
      timezone: 'America/New_York',
    })
  })

  test('a chapter_director is denied (out_of_scope: chapter.manage is platform-scoped), no chapter created', async () => {
    const director = await makeAdult(h.sql)
    const ctx = baseCtx(director, new Date(), [mem('chapter_director', randomUUID())])
    const slug = uniqueSlug()

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().create({ name: 'Should Not Exist', slug, tier: 'seed', timezone: 'UTC' }, ctx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
    expect(JSON.stringify(caught)).not.toMatch(/out_of_scope/)

    const rows = await h.sql`select id from chapter where slug = ${slug}`
    expect(rows).toHaveLength(0)

    const denied = await h.sql`
      select detail from audit_entry
      where action = 'permission.denied' and actor_account_id = ${director}
        and detail->>'capability' = 'chapter.manage'
    `
    expect(denied).toHaveLength(1)
    expect(denied[0]!.detail).toMatchObject({ capability: 'chapter.manage', reason: 'out_of_scope' })
  })
})

// ===========================================================================
describe('ChapterService.update', () => {
  test('a platform_admin updates status, tier, and name', async () => {
    const { ctx } = await adminCtx()
    let chapterId!: string
    await withRequest(async () => {
      const c = await svc().create(
        { name: 'Before', slug: uniqueSlug(), tier: 'seed', timezone: 'UTC' },
        ctx,
      )
      chapterId = c.chapterId
    })

    let updated!: Awaited<ReturnType<ChapterService['update']>>
    await withRequest(async () => {
      updated = await svc().update(chapterId, { status: 'active', tier: 'distinguished', name: 'After' }, ctx)
    })
    expect(updated).toMatchObject({ chapterId, status: 'active', tier: 'distinguished', name: 'After' })

    const [row] = await h.sql`select name, tier, status from chapter where id = ${chapterId}`
    expect(row).toMatchObject({ name: 'After', tier: 'distinguished', status: 'active' })
  })

  test('updating an unknown chapter is a ChapterNotFoundError', async () => {
    const { ctx } = await adminCtx()
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().update(randomUUID(), { status: 'paused' }, ctx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(ChapterNotFoundError)
  })

  test('a chapter_director is denied update (out_of_scope), the row is unchanged', async () => {
    const { ctx: adminC } = await adminCtx()
    let chapterId!: string
    await withRequest(async () => {
      const c = await svc().create({ name: 'Immutable', slug: uniqueSlug(), tier: 'seed', timezone: 'UTC' }, adminC)
      chapterId = c.chapterId
    })

    const director = await makeAdult(h.sql)
    const ctx = baseCtx(director, new Date(), [mem('chapter_director', chapterId)])
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().update(chapterId, { status: 'closed', name: 'Hijacked' }, ctx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)

    const [row] = await h.sql`select name, status from chapter where id = ${chapterId}`
    expect(row).toMatchObject({ name: 'Immutable', status: 'prospective' })
  })
})
