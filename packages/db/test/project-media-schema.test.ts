// -------------------------------------------------------------------------
// Milestone 3.1 — project / media / profile / verification schema guarantees.
//
// The additive migration 0015_project_media.sql adds project, project_media,
// media_depiction, profile_narrative, and verification_token. These tests are
// the red-before-green witnesses for its guarantees: the verification_token
// one-live-per-subject partial unique index and token_hash uniqueness, the
// media_depiction composite primary key, the enum/default discipline on
// project / project_media / profile_narrative, project foreign-key resolution,
// and the Mechanism-A grants (app DML; analytics default-deny, verification_token
// especially).
//
// TDD: run with CURIOLAB_MIGRATE_UPTO=0014 to witness these fail (the relations
// do not exist yet); the default run applies 0015 and they pass. Reuses the
// shared embedded-Postgres harness (one server per package, per-file template
// clone) exactly like feed-content.test.ts / moderation.test.ts.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMembership } from './helpers/fixtures.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness({ uptoInclusive: process.env.CURIOLAB_MIGRATE_UPTO })
}, 240_000)

afterAll(async () => {
  await h?.end()
})

/** A chapter plus an active in-scope owning membership (an instructor, so the
 * student-DOB trigger is not in play — ownership is by membership regardless). */
async function owner(): Promise<{ chapter: string; membership: string }> {
  const chapter = await makeChapter(h.sql)
  const account = await makeAdult(h.sql)
  const membership = await makeMembership(h.sql, account, chapter, {
    role: 'lead_instructor',
    status: 'active',
  })
  return { chapter, membership }
}

async function makeProject(
  chapter: string,
  membership: string,
  overrides: { title?: string } = {},
): Promise<string> {
  const [row] = await h.sql`
    insert into project (chapter_id, owner_membership_id, title)
    values (${chapter}, ${membership}, ${overrides.title ?? 'My Robot'})
    returning id
  `
  return row!.id as string
}

async function makeMedia(project: string): Promise<string> {
  const [row] = await h.sql`
    insert into project_media (project_id, storage_ref)
    values (${project}, ${randomUUID()})
    returning id
  `
  return row!.id as string
}

// ---------------------------------------------------------------------------
describe('project enum, defaults, and foreign keys', () => {
  test('a valid project inserts and defaults status=draft', async () => {
    const { chapter, membership } = await owner()
    const [row] = await h.sql`
      insert into project (chapter_id, owner_membership_id, title)
      values (${chapter}, ${membership}, 'First project')
      returning status
    `
    expect(row!.status).toBe('draft')
  })

  test('an invalid project.status is rejected', async () => {
    const { chapter, membership } = await owner()
    await expect(h.sql`
      insert into project (chapter_id, owner_membership_id, title, status)
      values (${chapter}, ${membership}, 'x', 'bogus')
    `).rejects.toThrow(/invalid input value for enum|project_status/i)
  })

  test('a project referencing a real chapter and membership is accepted (control)', async () => {
    const { chapter, membership } = await owner()
    const id = await makeProject(chapter, membership)
    expect(id).toBeTruthy()
  })

  test('a project referencing a non-existent chapter is rejected', async () => {
    const { membership } = await owner()
    await expect(h.sql`
      insert into project (chapter_id, owner_membership_id, title)
      values (${randomUUID()}, ${membership}, 'x')
    `).rejects.toThrow(/foreign key|violates/i)
  })

  test('a project referencing a non-existent owner membership is rejected', async () => {
    const { chapter } = await owner()
    await expect(h.sql`
      insert into project (chapter_id, owner_membership_id, title)
      values (${chapter}, ${randomUUID()}, 'x')
    `).rejects.toThrow(/foreign key|violates/i)
  })
})

// ---------------------------------------------------------------------------
describe('project_media enum and defaults', () => {
  test('a valid project_media inserts and defaults review_status=pending_review', async () => {
    const { chapter, membership } = await owner()
    const project = await makeProject(chapter, membership)
    const [row] = await h.sql`
      insert into project_media (project_id, storage_ref)
      values (${project}, ${randomUUID()})
      returning review_status
    `
    expect(row!.review_status).toBe('pending_review')
  })

  test('an invalid project_media.review_status is rejected', async () => {
    const { chapter, membership } = await owner()
    const project = await makeProject(chapter, membership)
    await expect(h.sql`
      insert into project_media (project_id, storage_ref, review_status)
      values (${project}, ${randomUUID()}, 'bogus')
    `).rejects.toThrow(/invalid input value for enum|media_review_status/i)
  })
})

// ---------------------------------------------------------------------------
describe('media_depiction composite primary key', () => {
  test('a duplicate (media_id, account_id) is rejected', async () => {
    const { chapter, membership } = await owner()
    const project = await makeProject(chapter, membership)
    const media = await makeMedia(project)
    const account = await makeAdult(h.sql)
    const addedBy = await makeAdult(h.sql)
    await h.sql`
      insert into media_depiction (media_id, account_id, added_by, source)
      values (${media}, ${account}, ${addedBy}, 'student')
    `
    await expect(h.sql`
      insert into media_depiction (media_id, account_id, added_by, source)
      values (${media}, ${account}, ${addedBy}, 'mentor')
    `).rejects.toThrow(/duplicate|unique|primary key/i)
  })

  test('two different accounts on one media are allowed', async () => {
    const { chapter, membership } = await owner()
    const project = await makeProject(chapter, membership)
    const media = await makeMedia(project)
    const a1 = await makeAdult(h.sql)
    const a2 = await makeAdult(h.sql)
    const addedBy = await makeAdult(h.sql)
    await h.sql`
      insert into media_depiction (media_id, account_id, added_by, source)
      values (${media}, ${a1}, ${addedBy}, 'student')
    `
    const rows = await h.sql`
      insert into media_depiction (media_id, account_id, added_by, source)
      values (${media}, ${a2}, ${addedBy}, 'staff')
      returning media_id
    `
    expect(rows.length).toBe(1)
  })

  test('an invalid media_depiction.source is rejected', async () => {
    const { chapter, membership } = await owner()
    const project = await makeProject(chapter, membership)
    const media = await makeMedia(project)
    const account = await makeAdult(h.sql)
    const addedBy = await makeAdult(h.sql)
    await expect(h.sql`
      insert into media_depiction (media_id, account_id, added_by, source)
      values (${media}, ${account}, ${addedBy}, 'bogus')
    `).rejects.toThrow(/invalid input value for enum|media_source/i)
  })
})

// ---------------------------------------------------------------------------
describe('profile_narrative enum and defaults', () => {
  test('a valid profile_narrative inserts and defaults status=draft', async () => {
    const account = await makeAdult(h.sql)
    const [row] = await h.sql`
      insert into profile_narrative (account_id, body)
      values (${account}, 'Hello, I build robots.')
      returning status
    `
    expect(row!.status).toBe('draft')
  })

  test('an invalid profile_narrative.status is rejected', async () => {
    const account = await makeAdult(h.sql)
    await expect(h.sql`
      insert into profile_narrative (account_id, body, status)
      values (${account}, 'x', 'bogus')
    `).rejects.toThrow(/invalid input value for enum|narrative_status/i)
  })
})

// ---------------------------------------------------------------------------
describe('verification_token: one live token per subject', () => {
  async function subjectAndIssuer(): Promise<{ subject: string; issuer: string }> {
    const subject = await makeAdult(h.sql)
    const issuer = await makeAdult(h.sql)
    return { subject, issuer }
  }

  async function issue(subject: string, issuer: string, tokenHash: string): Promise<string> {
    const [row] = await h.sql`
      insert into verification_token (subject_account_id, token_hash, issued_by, issued_at)
      values (${subject}, ${tokenHash}, ${issuer}, now())
      returning id
    `
    return row!.id as string
  }

  test('a second non-revoked token for the same subject is rejected', async () => {
    const { subject, issuer } = await subjectAndIssuer()
    await issue(subject, issuer, randomUUID())
    await expect(issue(subject, issuer, randomUUID())).rejects.toThrow(/duplicate|unique/i)
  })

  test('issuing again after revoking the first succeeds', async () => {
    const { subject, issuer } = await subjectAndIssuer()
    const first = await issue(subject, issuer, randomUUID())
    await h.sql`update verification_token set revoked_at = now() where id = ${first}`
    const second = await issue(subject, issuer, randomUUID())
    expect(second).toBeTruthy()
  })

  test('token_hash is globally unique (across subjects)', async () => {
    const { subject, issuer } = await subjectAndIssuer()
    const other = await makeAdult(h.sql)
    const hash = randomUUID()
    await issue(subject, issuer, hash)
    await expect(issue(other, issuer, hash)).rejects.toThrow(/duplicate|unique/i)
  })
})

// ---------------------------------------------------------------------------
describe('Mechanism A: grants on the M3.1 tables', () => {
  async function aToken(): Promise<string> {
    const subject = await makeAdult(h.sql)
    const issuer = await makeAdult(h.sql)
    const [row] = await h.sql`
      insert into verification_token (subject_account_id, token_hash, issued_by, issued_at)
      values (${subject}, ${randomUUID()}, ${issuer}, now())
      returning id
    `
    return row!.id as string
  }

  test('the analytics role is denied SELECT on verification_token (default-deny stance)', async () => {
    await aToken()
    const analytics = h.connectAs('curiolab_analytics', 'analytics_pw')
    await expect(analytics`select 1 from verification_token limit 1`).rejects.toThrow(
      /permission denied/i,
    )
  })

  test('the analytics role is denied SELECT on project (default-deny stance)', async () => {
    const analytics = h.connectAs('curiolab_analytics', 'analytics_pw')
    await expect(analytics`select 1 from project limit 1`).rejects.toThrow(/permission denied/i)
  })

  test('the app role may read and write verification_token (control)', async () => {
    const subject = await makeAdult(h.sql)
    const issuer = await makeAdult(h.sql)
    const app = h.connectAs('curiolab_app', 'app_pw')
    const rows = await app`
      insert into verification_token (subject_account_id, token_hash, issued_by, issued_at)
      values (${subject}, ${randomUUID()}, ${issuer}, now())
      returning id
    `
    expect(rows.length).toBe(1)
  })

  test('the app role may read project (control)', async () => {
    const app = h.connectAs('curiolab_app', 'app_pw')
    const rows = await app`select 1 from project limit 1`
    expect(Array.isArray(rows)).toBe(true)
  })
})
