// -------------------------------------------------------------------------
// Admin/Director backend P2 — invite-kind + token-binding schema guarantees.
//
// The additive migration 0021_invite_kinds_and_binding.sql:
//   * adds `director` and `admin` to the invite_kind enum (the two new
//     privileged invite kinds);
//   * adds invite.bound_chapter_id — the chapter the token is bound to at
//     REDEMPTION (adult invites carry no enrollment record, so the chapter can
//     no longer be derived only through the enrollment join);
//   * adds the director_invite_request table that records the two-person
//     director-invite approval as an explicit, auditable pair of actors +
//     timestamps, with a DB CHECK that the approver is DISTINCT from the
//     initiator (a single director acting alone cannot mint a director invite).
//
// TDD: run with CURIOLAB_MIGRATE_UPTO=0020 to witness these fail (the enum
// values and the relation/column do not exist yet); the default run applies
// 0021 and they pass. Reuses the shared embedded-Postgres harness exactly like
// the other *-schema tests. Synthetic data only.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter } from './helpers/fixtures.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness({ uptoInclusive: process.env.CURIOLAB_MIGRATE_UPTO })
}, 240_000)

afterAll(async () => {
  await h?.end()
})

/** Insert an issued invite of the given kind, bound to a chapter (no enrollment). */
async function insertInvite(
  kind: string,
  chapterId: string,
  issuedBy: string,
  targetEmail: string | null = null,
): Promise<string> {
  const [row] = await h.sql`
    insert into invite (
      token_hash, kind, target_email, bound_chapter_id, issued_by,
      expires_at, status, delivery_status
    ) values (
      ${`hash-${randomUUID()}`}, ${kind}, ${targetEmail}, ${chapterId}, ${issuedBy},
      now() + interval '72 hours', 'issued', 'sent'
    ) returning id
  `
  return row!.id as string
}

// ---------------------------------------------------------------------------
describe('invite_kind enum: director + admin', () => {
  test('an invite of kind director inserts', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const id = await insertInvite('director', chapter, director, `d-${randomUUID().slice(0, 8)}@example.test`)
    const [row] = await h.sql`select kind from invite where id = ${id}`
    expect(row!.kind).toBe('director')
  })

  test('an invite of kind admin inserts', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const id = await insertInvite('admin', chapter, director, `a-${randomUUID().slice(0, 8)}@example.test`)
    const [row] = await h.sql`select kind from invite where id = ${id}`
    expect(row!.kind).toBe('admin')
  })

  test('an unknown invite kind is still rejected', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    await expect(insertInvite('superuser', chapter, director)).rejects.toThrow(
      /invalid input value for enum|invite_kind/i,
    )
  })
})

// ---------------------------------------------------------------------------
describe('invite.bound_chapter_id — the redemption chapter binding', () => {
  test('bound_chapter_id is stored and FK-checked against chapter', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const id = await insertInvite('mentor', chapter, director, `m-${randomUUID().slice(0, 8)}@example.test`)
    const [row] = await h.sql`select bound_chapter_id from invite where id = ${id}`
    expect(row!.bound_chapter_id).toBe(chapter)
  })

  test('a bound_chapter_id that is not a real chapter is rejected', async () => {
    const director = await makeAdult(h.sql)
    await expect(insertInvite('mentor', randomUUID(), director)).rejects.toThrow(
      /foreign key|violates/i,
    )
  })
})

// ---------------------------------------------------------------------------
describe('director_invite_request — the two-person approval record', () => {
  async function twoDirectors() {
    const chapter = await makeChapter(h.sql)
    const a = await makeAdult(h.sql)
    const b = await makeAdult(h.sql)
    return { chapter, a, b }
  }

  test('a pending request records the initiator, the chapter, and both actor slots default null', async () => {
    const { chapter, a } = await twoDirectors()
    const [row] = await h.sql`
      insert into director_invite_request (chapter_id, target_email, initiated_by, expires_at)
      values (${chapter}, ${`new-${randomUUID().slice(0, 8)}@example.test`}, ${a}, now() + interval '72 hours')
      returning status, approved_by, approved_at, invite_id, initiated_at, created_at
    `
    expect(row!.status).toBe('pending')
    expect(row!.approved_by).toBeNull()
    expect(row!.approved_at).toBeNull()
    expect(row!.invite_id).toBeNull()
    expect(row!.initiated_at).not.toBeNull()
    expect(row!.created_at).not.toBeNull()
  })

  test('a DISTINCT second director may be recorded as the approver', async () => {
    const { chapter, a, b } = await twoDirectors()
    const [row] = await h.sql`
      insert into director_invite_request (chapter_id, target_email, initiated_by, approved_by, approved_at, status, expires_at)
      values (${chapter}, ${`new-${randomUUID().slice(0, 8)}@example.test`}, ${a}, ${b}, now(), 'approved', now() + interval '72 hours')
      returning id
    `
    expect(row!.id).toBeTruthy()
  })

  test('the same director cannot be both initiator and approver (the distinct-approver CHECK)', async () => {
    const { chapter, a } = await twoDirectors()
    await expect(h.sql`
      insert into director_invite_request (chapter_id, target_email, initiated_by, approved_by, approved_at, status, expires_at)
      values (${chapter}, ${`new-${randomUUID().slice(0, 8)}@example.test`}, ${a}, ${a}, now(), 'approved', now() + interval '72 hours')
    `).rejects.toThrow(/check|distinct|approver/i)
  })

  test('initiated_by is NOT NULL and FK-checked', async () => {
    const { chapter } = await twoDirectors()
    await expect(h.sql`
      insert into director_invite_request (chapter_id, target_email, initiated_by, expires_at)
      values (${chapter}, ${'x@example.test'}, ${randomUUID()}, now() + interval '72 hours')
    `).rejects.toThrow(/foreign key|violates/i)
  })
})

// ---------------------------------------------------------------------------
describe('Mechanism A: grants on director_invite_request', () => {
  test('the app role may DML director_invite_request', async () => {
    const chapter = await makeChapter(h.sql)
    const a = await makeAdult(h.sql)
    const app = h.connectAs('curiolab_app', 'app_pw')
    const rows = await app`
      insert into director_invite_request (chapter_id, target_email, initiated_by, expires_at)
      values (${chapter}, ${`g-${randomUUID().slice(0, 8)}@example.test`}, ${a}, now() + interval '72 hours')
      returning id
    `
    expect(rows.length).toBe(1)
    const upd = await app`
      update director_invite_request set status = 'approved' where id = ${rows[0]!.id} returning id
    `
    expect(upd.length).toBe(1)
  })
})
