// -------------------------------------------------------------------------
// Project lifecycle controllers (M3.7): create -> submit -> verify -> publish,
// plus unpublish. Embedded Postgres, synthetic data only. Tests the CONTROLLERS.
//
//   - POST  /api/projects                create   (student, project.create)
//   - PATCH /api/projects/:id/submit     submit   (owner, project.submit)
//   - POST  /api/projects/:id/verify     verify   (pod instructor / director)
//   - POST  /api/projects/:id/publish    publish  (director, scoped consent)
//   - POST  /api/projects/:id/unpublish  unpublish (director)
// -------------------------------------------------------------------------

import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { startHarness, type Harness } from './helpers/pg.js'
import { seedM3, seedProject, grantConsent } from './helpers/seed-m3.js'
import {
  createProject,
  submitProject,
  verifyProject,
  publishProject,
  unpublishProject,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

async function projectStatus(id: string): Promise<string | undefined> {
  const [r] = await h.sql`select status from project where id = ${id}`
  return r?.status as string | undefined
}

// ===========================================================================
describe('the create -> submit -> verify -> publish happy path', () => {
  test('a student creates and submits; an instructor verifies; a director publishes with scoped consent', async () => {
    const s = await seedM3(h.sql)

    const created = await createProject({
      sql: h.sql,
      sessionToken: s.studentToken,
      body: { chapterId: s.chapter, ownerMembershipId: s.studentMembership, title: 'My Robot' },
    })
    expect(created.status).toBe(201)
    const projectId = created.body.projectId
    expect(await projectStatus(projectId)).toBe('draft')

    const submitted = await submitProject({ sql: h.sql, sessionToken: s.studentToken, params: { id: projectId } })
    expect(submitted.status).toBe(200)
    expect(await projectStatus(projectId)).toBe('submitted')

    const verified = await verifyProject({ sql: h.sql, sessionToken: s.instructorToken, params: { id: projectId } })
    expect(verified.status).toBe(200)
    expect(await projectStatus(projectId)).toBe('verified')

    // The owner's external_publication consent, scoped to this project.
    await grantConsent(h.sql, s.student, s.guardian, 'external_publication', { scopeRef: projectId })

    const published = await publishProject({ sql: h.sql, sessionToken: s.directorToken, params: { id: projectId } })
    expect(published.status).toBe(200)
    expect(await projectStatus(projectId)).toBe('public_listed')

    const unpublished = await unpublishProject({ sql: h.sql, sessionToken: s.directorToken, params: { id: projectId } })
    expect(unpublished.status).toBe(200)
    expect(await projectStatus(projectId)).toBe('verified')
  })
})

// ===========================================================================
describe('publish without the scoped consent', () => {
  test('a verified project without the owner consent -> opaque 403, stays verified', async () => {
    const s = await seedM3(h.sql)
    const projectId = await seedProject(h.sql, s, 'verified')

    const res = await publishProject({ sql: h.sql, sessionToken: s.directorToken, params: { id: projectId } })
    expect(res.status).toBe(403)
    expect(JSON.stringify(res.body)).not.toMatch(/subject_consent|reason/)
    expect(await projectStatus(projectId)).toBe('verified')

    // Exactly one permission.denied row for the director.
    const denied = await h.sql`
      select count(*)::int as n from audit_entry
      where action = 'permission.denied' and actor_account_id = ${s.director}
        and detail->>'capability' = 'project.publish_public'
    `
    expect(denied[0]!.n).toBe(1)
  })
})
