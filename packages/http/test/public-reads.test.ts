// -------------------------------------------------------------------------
// Public read controllers (M3.7): the public_listed project directory and the
// published newsletter, both unauthenticated (runPublic). Embedded Postgres,
// synthetic data only. Archived/draft/hidden rows are NEVER returned.
//
//   - GET /api/public/projects        listPublicProjects (public_listed only)
//   - GET /api/public/projects/:id    viewPublicProject
//   - GET /api/public/newsletter      listPublicNewsletters (published only)
//   - GET /api/public/newsletter/:slug viewPublicNewsletter
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { startHarness, type Harness } from './helpers/pg.js'
import { seedM3, seedProject } from './helpers/seed-m3.js'
import {
  listPublicProjects,
  viewPublicProject,
  listPublicNewsletters,
  viewPublicNewsletter,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

// ===========================================================================
describe('the public project directory returns only public_listed rows', () => {
  test('a public_listed project appears; draft and verified do not; no session required', async () => {
    const s = await seedM3(h.sql)
    const listed = await seedProject(h.sql, s, 'public_listed', 'Showcased Bot')
    await seedProject(h.sql, s, 'draft', 'Secret Draft')
    await seedProject(h.sql, s, 'verified', 'Verified But Not Public')

    const res = await listPublicProjects({ sql: h.sql })
    expect(res.status).toBe(200)
    const ids = res.body.projects.map((p) => p.projectId)
    expect(ids).toContain(listed)
    const titles = res.body.projects.map((p) => p.title)
    expect(titles).not.toContain('Secret Draft')
    expect(titles).not.toContain('Verified But Not Public')
  })

  test('viewPublicProject returns a public_listed project; a verified one is 404', async () => {
    const s = await seedM3(h.sql)
    const listed = await seedProject(h.sql, s, 'public_listed', 'Showcased Bot')
    const verified = await seedProject(h.sql, s, 'verified', 'Hidden')

    const ok = await viewPublicProject({ sql: h.sql, params: { id: listed } })
    expect(ok.status).toBe(200)
    expect((ok.body as { title: string }).title).toBe('Showcased Bot')

    const notFound = await viewPublicProject({ sql: h.sql, params: { id: verified } })
    expect(notFound.status).toBe(404)

    const missing = await viewPublicProject({ sql: h.sql, params: { id: randomUUID() } })
    expect(missing.status).toBe(404)
  })
})

// ===========================================================================
describe('the public newsletter returns only published issues', () => {
  test('a published issue appears; a draft and an archived do not', async () => {
    const s = await seedM3(h.sql)
    const [pub] = await h.sql`
      insert into newsletter_issue (chapter_id, title, body, status, published_at)
      values (${s.chapter}, 'Published Issue', 'Body', 'published', now()) returning id
    `
    await h.sql`
      insert into newsletter_issue (chapter_id, title, body, status)
      values (${s.chapter}, 'Draft Issue', 'Body', 'draft')
    `
    await h.sql`
      insert into newsletter_issue (chapter_id, title, body, status)
      values (${s.chapter}, 'Archived Issue', 'Body', 'archived')
    `

    const res = await listPublicNewsletters({ sql: h.sql })
    expect(res.status).toBe(200)
    const titles = res.body.issues.map((i) => i.title)
    expect(titles).toContain('Published Issue')
    expect(titles).not.toContain('Draft Issue')
    expect(titles).not.toContain('Archived Issue')

    const one = await viewPublicNewsletter({ sql: h.sql, params: { slug: pub!.id as string } })
    expect(one.status).toBe(200)
    expect((one.body as { title: string }).title).toBe('Published Issue')
  })

  test('a draft issue read by id is 404 (never leaks an unpublished issue)', async () => {
    const s = await seedM3(h.sql)
    const [draft] = await h.sql`
      insert into newsletter_issue (chapter_id, title, body, status)
      values (${s.chapter}, 'Draft Issue', 'Body', 'draft') returning id
    `
    const res = await viewPublicNewsletter({ sql: h.sql, params: { slug: draft!.id as string } })
    expect(res.status).toBe(404)
  })
})
