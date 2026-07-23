// -------------------------------------------------------------------------
// Media ops controllers (M3.7): attach (student, own project) + the photo-review
// policy actions (confirm-depiction / clear / remove, media.review). Embedded
// Postgres, synthetic data only. Tests the CONTROLLERS.
//
//   - POST /api/ops/media                     attachMedia (project.submit, own)
//   - POST /api/ops/media/:id/confirm-depiction confirmDepiction (media.review)
//   - POST /api/ops/media/:id/clear           clearMedia (media.review)
//   - POST /api/ops/media/:id/remove          removeMedia (media.review)
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { startHarness, type Harness } from './helpers/pg.js'
import { seedM3, seedProject } from './helpers/seed-m3.js'
import { attachMedia, confirmDepiction, removeMedia } from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

async function attachOne(s: Awaited<ReturnType<typeof seedM3>>, projectId: string): Promise<string> {
  const res = await attachMedia({
    sql: h.sql,
    sessionToken: s.studentToken,
    body: { projectId, storageRef: randomUUID(), depictions: [{ accountId: s.student }] },
  })
  expect(res.status).toBe(201)
  return res.body.mediaId
}

// ===========================================================================
describe('attach + confirm-depiction', () => {
  test('a student attaches to their own project (pending_review)', async () => {
    const s = await seedM3(h.sql)
    const projectId = await seedProject(h.sql, s, 'draft')
    const res = await attachMedia({
      sql: h.sql,
      sessionToken: s.studentToken,
      body: { projectId, storageRef: randomUUID() },
    })
    expect(res.status).toBe(201)
    expect(res.body.reviewStatus).toBe('pending_review')
  })

  test('a reviewer (pod instructor) confirms a depiction', async () => {
    const s = await seedM3(h.sql)
    const projectId = await seedProject(h.sql, s, 'draft')
    const mediaId = await attachOne(s, projectId)

    const res = await confirmDepiction({
      sql: h.sql,
      sessionToken: s.instructorToken,
      params: { id: mediaId },
      body: { accountId: s.student },
    })
    expect(res.status).toBe(200)
    expect(['mentor', 'staff']).toContain(res.body.source)
    const [d] = await h.sql`
      select confirmed_at from media_depiction where media_id = ${mediaId} and account_id = ${s.student}
    `
    expect(d!.confirmed_at).not.toBeNull()
  })

  test('a non-reviewer (the student) is denied confirm-depiction -> opaque 403', async () => {
    const s = await seedM3(h.sql)
    const projectId = await seedProject(h.sql, s, 'draft')
    const mediaId = await attachOne(s, projectId)

    const res = await confirmDepiction({
      sql: h.sql,
      sessionToken: s.studentToken,
      params: { id: mediaId },
      body: { accountId: s.student },
    })
    expect(res.status).toBe(403)
    expect(JSON.stringify(res.body)).not.toMatch(/reason|out_of_scope/)
    const [d] = await h.sql`
      select confirmed_at from media_depiction where media_id = ${mediaId} and account_id = ${s.student}
    `
    expect(d!.confirmed_at).toBeNull()
  })

  test('a reviewer removes a media (removed)', async () => {
    const s = await seedM3(h.sql)
    const projectId = await seedProject(h.sql, s, 'draft')
    const mediaId = await attachOne(s, projectId)
    const res = await removeMedia({ sql: h.sql, sessionToken: s.instructorToken, params: { id: mediaId } })
    expect(res.status).toBe(200)
    expect(res.body.reviewStatus).toBe('removed')
  })
})
