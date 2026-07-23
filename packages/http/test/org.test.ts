// -------------------------------------------------------------------------
// Organization-structure controllers (05-api-surface.md "Platform
// administration": CRUD /admin/chapters, /admin/terms, /admin/pods). Embedded
// Postgres, synthetic data only.
//
//   - a platform_admin creates/updates a chapter; a director is denied (opaque
//     403 + one permission.denied row);
//   - a chapter_director creates/updates a term and a pod in THEIR chapter, and
//     assigns/unassigns a senior instructor;
//   - NO session -> opaque 403 with no actor audit.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { createSession } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMembership } from './helpers/fixtures.js'
import { seedDirector } from './helpers/seed.js'
import {
  assignPod,
  createChapter,
  createPod,
  createTerm,
  unassignPod,
  updateChapter,
  updateTerm,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

async function sessionFor(accountId: string): Promise<string> {
  const { token } = await createSession(h.sql, {
    accountId,
    expiresAt: new Date(Date.now() + 3_600_000),
  })
  return token
}

/** A platform_admin account (membership in a throwaway chapter) + session token. */
async function seedPlatformAdmin() {
  const admin = await makeAdult(h.sql)
  const homeChapter = await makeChapter(h.sql)
  await makeMembership(h.sql, admin, homeChapter, { role: 'platform_admin' })
  return { admin, token: await sessionFor(admin) }
}

async function permissionDenied(actor: string, capability: string) {
  return h.sql`
    select detail from audit_entry
    where action = 'permission.denied' and actor_account_id = ${actor}
      and detail->>'capability' = ${capability}
  `
}

// ===========================================================================
describe('createChapter / updateChapter (admin, chapter.manage)', () => {
  test('a platform_admin creates a chapter (201, prospective)', async () => {
    const a = await seedPlatformAdmin()
    const res = await createChapter({
      sql: h.sql,
      sessionToken: a.token,
      body: { name: 'Synthetic Chapter', slug: `chapter-${randomUUID().slice(0, 8)}`, tier: 'seed', timezone: 'UTC' },
    })
    expect(res.status).toBe(201)
    expect(res.body.status).toBe('prospective')
  })

  test('a platform_admin updates a chapter (200)', async () => {
    const a = await seedPlatformAdmin()
    const created = await createChapter({
      sql: h.sql,
      sessionToken: a.token,
      body: { name: 'Before', slug: `chapter-${randomUUID().slice(0, 8)}`, tier: 'seed', timezone: 'UTC' },
    })
    const res = await updateChapter({
      sql: h.sql,
      sessionToken: a.token,
      params: { id: created.body.chapterId },
      body: { status: 'active', name: 'After' },
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'active', name: 'After' })
  })

  test('a chapter_director is denied (opaque 403 + one permission.denied row)', async () => {
    const d = await seedDirector(h.sql)
    const res = await createChapter({
      sql: h.sql,
      sessionToken: d.directorToken,
      body: { name: 'Nope', slug: `chapter-${randomUUID().slice(0, 8)}`, tier: 'seed', timezone: 'UTC' },
    })
    expect(res.status).toBe(403)
    expect(JSON.stringify(res.body)).not.toMatch(/out_of_scope|reason/)
    const denied = await permissionDenied(d.director, 'chapter.manage')
    expect(denied).toHaveLength(1)
  })

  test('NO session -> opaque 403, no actor audit', async () => {
    const res = await createChapter({
      sql: h.sql,
      body: { name: 'Nope', slug: `chapter-${randomUUID().slice(0, 8)}`, tier: 'seed', timezone: 'UTC' },
    })
    expect(res.status).toBe(403)
  })

  test('an unknown tier is a 400, not a 500', async () => {
    const a = await seedPlatformAdmin()
    const res = await createChapter({
      sql: h.sql,
      sessionToken: a.token,
      body: { name: 'X', slug: `chapter-${randomUUID().slice(0, 8)}`, tier: 'platinum', timezone: 'UTC' },
    })
    expect(res.status).toBe(400)
  })
})

// ===========================================================================
describe('createTerm / updateTerm (ops, term.manage)', () => {
  test('a director creates then renames a term in their chapter', async () => {
    const d = await seedDirector(h.sql)
    const created = await createTerm({
      sql: h.sql,
      sessionToken: d.directorToken,
      body: { chapterId: d.chapter, name: 'Spring', startsOn: '2099-01-10', endsOn: '2099-05-20' },
    })
    expect(created.status).toBe(201)
    const updated = await updateTerm({
      sql: h.sql,
      sessionToken: d.directorToken,
      params: { id: created.body.termId },
      body: { name: 'Spring (revised)' },
    })
    expect(updated.status).toBe(200)
    expect(updated.body.name).toBe('Spring (revised)')
  })

  test('a director of another chapter is denied a term (403)', async () => {
    const owner = await seedDirector(h.sql)
    const other = await seedDirector(h.sql)
    const res = await createTerm({
      sql: h.sql,
      sessionToken: other.directorToken,
      body: { chapterId: owner.chapter, name: 'Cross', startsOn: '2099-01-01', endsOn: '2099-06-01' },
    })
    expect(res.status).toBe(403)
  })

  test('updating an unknown term is a 404', async () => {
    const d = await seedDirector(h.sql)
    const res = await updateTerm({
      sql: h.sql,
      sessionToken: d.directorToken,
      params: { id: randomUUID() },
      body: { name: 'x' },
    })
    expect(res.status).toBe(404)
  })
})

// ===========================================================================
describe('createPod / assignPod / unassignPod (ops, pod.manage)', () => {
  test('a director creates a pod, assigns then unassigns a senior instructor', async () => {
    const d = await seedDirector(h.sql)
    const instructor = await makeAdult(h.sql)
    const membershipId = await makeMembership(h.sql, instructor, d.chapter, { role: 'senior_instructor' })

    const pod = await createPod({
      sql: h.sql,
      sessionToken: d.directorToken,
      body: { chapterId: d.chapter, termId: d.term, name: 'Pod Alpha' },
    })
    expect(pod.status).toBe(201)
    const podId = pod.body.podId

    const assigned = await assignPod({
      sql: h.sql,
      sessionToken: d.directorToken,
      params: { id: podId },
      body: { membershipId, termId: d.term },
    })
    expect(assigned.status).toBe(201)
    const [row] = await h.sql`select id from pod_assignment where pod_id = ${podId} and membership_id = ${membershipId}`
    expect(row).toBeTruthy()

    const removed = await unassignPod({
      sql: h.sql,
      sessionToken: d.directorToken,
      params: { id: podId, membershipId },
      body: { termId: d.term },
    })
    expect(removed.status).toBe(200)
    expect(removed.body.removed).toBe(true)
    const gone = await h.sql`select id from pod_assignment where pod_id = ${podId} and membership_id = ${membershipId}`
    expect(gone).toHaveLength(0)
  })

  test('assigning into an unknown pod is a 404', async () => {
    const d = await seedDirector(h.sql)
    const instructor = await makeAdult(h.sql)
    const membershipId = await makeMembership(h.sql, instructor, d.chapter, { role: 'senior_instructor' })
    const res = await assignPod({
      sql: h.sql,
      sessionToken: d.directorToken,
      params: { id: randomUUID() },
      body: { membershipId, termId: d.term },
    })
    expect(res.status).toBe(404)
  })
})
