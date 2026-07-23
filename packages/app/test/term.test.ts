// -------------------------------------------------------------------------
// TermService tests (Platform administration; 05-api-surface CRUD /admin/terms).
// A chapter_director creates and updates terms in THEIR chapter; a director of
// another chapter is denied (out_of_scope); a platform_admin manages any chapter
// via the override. Embedded Postgres, synthetic data only.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Forbidden, authorize, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import {
  TermService,
  TermNotFoundError,
  type TermAuthorizeFn,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

function svc(authorizeFn = authorize as unknown as TermAuthorizeFn) {
  return new TermService({ sql: h.sql, authorize: authorizeFn })
}

function directorCtx(director: string, chapter: string) {
  return baseCtx(director, new Date(), [mem('chapter_director', chapter)])
}

// ===========================================================================
describe('TermService.create', () => {
  test('a director creates a term in THEIR chapter', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const ctx = directorCtx(director, chapter)

    let result!: Awaited<ReturnType<TermService['create']>>
    await withRequest(async () => {
      result = await svc().create(
        chapter,
        { name: 'Fall Term 2099', startsOn: '2099-09-01', endsOn: '2099-12-15' },
        ctx,
      )
    })
    expect(result).toMatchObject({
      chapterId: chapter,
      name: 'Fall Term 2099',
      startsOn: '2099-09-01',
      endsOn: '2099-12-15',
    })
    const [row] = await h.sql`select chapter_id, name, starts_on, ends_on from term where id = ${result.termId}`
    expect(row!.chapter_id).toBe(chapter)
    expect(row!.name).toBe('Fall Term 2099')
  })

  test('a director of ANOTHER chapter is denied (out_of_scope), no term created', async () => {
    const chapter = await makeChapter(h.sql)
    const otherChapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const ctx = directorCtx(director, otherChapter)

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().create(chapter, { name: 'Cross-Chapter', startsOn: '2099-01-01', endsOn: '2099-06-01' }, ctx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)

    const rows = await h.sql`select id from term where chapter_id = ${chapter}`
    expect(rows).toHaveLength(0)
    const denied = await h.sql`
      select detail from audit_entry
      where action = 'permission.denied' and actor_account_id = ${director}
        and detail->>'capability' = 'term.manage'
    `
    expect(denied).toHaveLength(1)
    expect(denied[0]!.detail).toMatchObject({ reason: 'out_of_scope' })
  })

  test('a platform_admin may create a term in any chapter (via the override)', async () => {
    const chapter = await makeChapter(h.sql)
    const admin = await makeAdult(h.sql)
    const ctx = baseCtx(admin, new Date(), [mem('platform_admin', 'platform')])
    let result!: Awaited<ReturnType<TermService['create']>>
    await withRequest(async () => {
      result = await svc().create(chapter, { name: 'Admin Term', startsOn: '2099-09-01', endsOn: '2099-12-15' }, ctx)
    })
    expect(result.chapterId).toBe(chapter)
  })
})

// ===========================================================================
describe('TermService.update', () => {
  test('a director renames a term in their chapter', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const ctx = directorCtx(director, chapter)
    let termId!: string
    await withRequest(async () => {
      termId = (await svc().create(chapter, { name: 'Before', startsOn: '2099-09-01', endsOn: '2099-12-15' }, ctx)).termId
    })

    let updated!: Awaited<ReturnType<TermService['update']>>
    await withRequest(async () => {
      updated = await svc().update(termId, { name: 'After', endsOn: '2099-12-20' }, ctx)
    })
    expect(updated).toMatchObject({ termId, name: 'After', endsOn: '2099-12-20' })
    const [row] = await h.sql`select name, ends_on from term where id = ${termId}`
    expect(row!.name).toBe('After')
  })

  test('a director of another chapter cannot update the term (out_of_scope), unchanged', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const ownerCtx = directorCtx(director, chapter)
    let termId!: string
    await withRequest(async () => {
      termId = (await svc().create(chapter, { name: 'Owned', startsOn: '2099-09-01', endsOn: '2099-12-15' }, ownerCtx)).termId
    })

    const otherChapter = await makeChapter(h.sql)
    const intruder = await makeAdult(h.sql)
    const intruderCtx = directorCtx(intruder, otherChapter)
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().update(termId, { name: 'Hijacked' }, intruderCtx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
    const [row] = await h.sql`select name from term where id = ${termId}`
    expect(row!.name).toBe('Owned')
  })

  test('updating an unknown term is a TermNotFoundError', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const ctx = directorCtx(director, chapter)
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().update(randomUUID(), { name: 'nope' }, ctx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(TermNotFoundError)
  })
})
