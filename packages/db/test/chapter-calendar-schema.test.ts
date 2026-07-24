// -------------------------------------------------------------------------
// guardian/director portal work order, Feature 1 — the shared, audience-scoped
// chapter calendar (director-authored), as an APPEND-ONLY event-sourced log.
//
// The additive migration 0026_chapter_calendar.sql models the calendar as an
// append-only revision log: one row per (event, revision), with a stable
// `event_id` across revisions, a `version`, a `status` (active|canceled), the
// full field snapshot (title, kind, starts_at, ends_at, audiences[], location,
// notes), and the actor/time of that revision. A current-state projection view
// `calendar_event_current` picks the LATEST revision per event_id and carries the
// ORIGINAL creator/created_at forward. Mirrors the consent_grant / mentor_eligibility
// pattern (0024/0025) — an edit or cancel is a NEW row, never a mutation — so it
// composes with the same reject_append_only_mutation() trigger + role REVOKE.
//
// These are the red-before-green witnesses:
//   * calendar_event exists; the kind / audience / status enums; chapter/account
//     fks; audiences is a non-empty enum ARRAY;
//   * the ends_at > starts_at and non-empty-audiences CHECKs bite;
//   * append-only (UPDATE/DELETE rejected by the trigger + role REVOKE);
//   * calendar_event_current reflects the latest revision per event_id, a later
//     revision (edit / cancel tombstone) supersedes, and created_by/created_at
//     stay the ORIGINAL v1 values;
//   * Mechanism-A grants: app may SELECT/INSERT (not UPDATE/DELETE).
//
// TDD: run with CURIOLAB_MIGRATE_UPTO=0025 to witness these fail (the relations do
// not exist yet); the default run applies 0026 and they pass.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startHarness, type Harness } from './helpers/pg.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness({ uptoInclusive: process.env.CURIOLAB_MIGRATE_UPTO })
}, 240_000)

afterAll(async () => {
  await h?.end()
})

async function makeAccount(): Promise<string> {
  const [row] = await h.sql`
    insert into account (
      email, username, legal_name, display_name, date_of_birth,
      dob_provenance, dob_source_ref, credential_owner, status, maturation_state
    ) values (
      ${`director-${randomUUID().slice(0, 8)}@example.test`}, ${null}, 'Adult Testperson', 'Adult T.',
      '1990-01-01', 'staff_entered', ${null}, 'self_private', 'active', 'self_managed'
    ) returning id
  `
  return row!.id as string
}

async function makeChapter(): Promise<string> {
  const [row] = await h.sql`
    insert into chapter (name, slug, tier, status, timezone)
    values ('Test Chapter', ${'chapter-' + randomUUID()}, 'active', 'active', 'America/New_York')
    returning id
  `
  return row!.id as string
}

/** Insert one calendar_event revision row; returns the row. */
async function insertRevision(o: {
  eventId?: string
  chapterId: string
  version?: number
  status?: string
  title?: string
  kind?: string
  startsAt?: string
  endsAt?: string
  audiences?: string[]
  location?: string | null
  notes?: string | null
  createdBy: string
}) {
  const eventId = o.eventId ?? randomUUID()
  const audiences = o.audiences ?? ['parent', 'mentor', 'director']
  const [row] = await h.sql`
    insert into calendar_event (
      event_id, chapter_id, version, status, title, kind, starts_at, ends_at,
      audiences, location, notes, created_by_account_id
    ) values (
      ${eventId}, ${o.chapterId}, ${o.version ?? 1}, ${o.status ?? 'active'},
      ${o.title ?? 'Saturday Session'}, ${o.kind ?? 'session'},
      ${o.startsAt ?? '2099-10-03T14:00:00Z'}, ${o.endsAt ?? '2099-10-03T16:00:00Z'},
      ${audiences}::calendar_audience[], ${o.location ?? null}, ${o.notes ?? null}, ${o.createdBy}
    ) returning id, event_id, seq, version, status, audiences, created_by_account_id, created_at
  `
  return row!
}

// ---------------------------------------------------------------------------
describe('calendar_event shape and enums', () => {
  test('a v1 row inserts with kind, audiences[], starts/ends, event_id + seq', async () => {
    const chapter = await makeChapter()
    const director = await makeAccount()
    const row = await insertRevision({
      chapterId: chapter,
      createdBy: director,
      audiences: ['parent', 'mentor'],
    })
    expect(row.id).toBeTruthy()
    expect(row.event_id).toBeTruthy()
    expect(row.seq).toBeTruthy()
    expect(row.version).toBe(1)
    expect(row.status).toBe('active')
    expect(row.audiences).toEqual(['parent', 'mentor'])
    expect(row.created_by_account_id).toBe(director)
    expect(row.created_at).not.toBeNull()
  })

  test('kind is a checked enum: garbage is rejected', async () => {
    const chapter = await makeChapter()
    const director = await makeAccount()
    await expect(
      insertRevision({ chapterId: chapter, createdBy: director, kind: 'not_a_kind' }),
    ).rejects.toThrow(/invalid input value for enum/i)
  })

  test('all four kinds are accepted', async () => {
    const chapter = await makeChapter()
    const director = await makeAccount()
    for (const kind of ['session', 'orientation', 'meeting', 'other']) {
      const row = await insertRevision({ chapterId: chapter, createdBy: director, kind })
      expect(row.id).toBeTruthy()
    }
  })

  test('audience is a checked enum: a bad audience value is rejected', async () => {
    const chapter = await makeChapter()
    const director = await makeAccount()
    await expect(
      insertRevision({ chapterId: chapter, createdBy: director, audiences: ['staff'] }),
    ).rejects.toThrow(/invalid input value for enum/i)
  })

  test('status is a checked enum: a bad status is rejected', async () => {
    const chapter = await makeChapter()
    const director = await makeAccount()
    await expect(
      insertRevision({ chapterId: chapter, createdBy: director, status: 'deleted' }),
    ).rejects.toThrow(/invalid input value for enum/i)
  })

  test('chapter fk is checked', async () => {
    const director = await makeAccount()
    await expect(
      insertRevision({ chapterId: randomUUID(), createdBy: director }),
    ).rejects.toThrow(/foreign key|violates/i)
  })

  test('location + notes are optional columns that persist', async () => {
    const chapter = await makeChapter()
    const director = await makeAccount()
    const eventId = randomUUID()
    await insertRevision({
      eventId,
      chapterId: chapter,
      createdBy: director,
      location: 'Room 214, Sears',
      notes: 'Bring a laptop',
    })
    const [row] = await h.sql`
      select location, notes from calendar_event where event_id = ${eventId}
    `
    expect(row!.location).toBe('Room 214, Sears')
    expect(row!.notes).toBe('Bring a laptop')
  })
})

// ---------------------------------------------------------------------------
describe('calendar_event CHECK constraints', () => {
  test('ends_at must be strictly after starts_at', async () => {
    const chapter = await makeChapter()
    const director = await makeAccount()
    await expect(
      insertRevision({
        chapterId: chapter,
        createdBy: director,
        startsAt: '2099-10-03T16:00:00Z',
        endsAt: '2099-10-03T14:00:00Z',
      }),
    ).rejects.toThrow(/check|violates/i)
    // equal is also rejected (strictly after).
    await expect(
      insertRevision({
        chapterId: chapter,
        createdBy: director,
        startsAt: '2099-10-03T16:00:00Z',
        endsAt: '2099-10-03T16:00:00Z',
      }),
    ).rejects.toThrow(/check|violates/i)
  })

  test('audiences must be non-empty (an empty array is rejected)', async () => {
    const chapter = await makeChapter()
    const director = await makeAccount()
    await expect(
      insertRevision({ chapterId: chapter, createdBy: director, audiences: [] }),
    ).rejects.toThrow(/check|violates/i)
  })
})

// ---------------------------------------------------------------------------
describe('calendar_event_current projection', () => {
  test('shows the latest revision per event_id; created_by/created_at are the original', async () => {
    const chapter = await makeChapter()
    const creator = await makeAccount()
    const editor = await makeAccount()
    const eventId = randomUUID()
    const v1 = await insertRevision({
      eventId,
      chapterId: chapter,
      version: 1,
      title: 'Original title',
      createdBy: creator,
    })
    await insertRevision({
      eventId,
      chapterId: chapter,
      version: 2,
      title: 'Edited title',
      audiences: ['parent'],
      createdBy: editor,
    })
    const [cur] = await h.sql`
      select event_id, version, status, title, audiences,
             created_by_account_id, created_at
      from calendar_event_current where event_id = ${eventId}
    `
    expect(cur!.version).toBe(2)
    expect(cur!.title).toBe('Edited title')
    expect(cur!.audiences).toEqual(['parent'])
    // The event's creator/createdAt are the ORIGINAL v1 values, not the editor's.
    expect(cur!.created_by_account_id).toBe(creator)
    expect(new Date(cur!.created_at as string).getTime()).toBe(
      new Date(v1.created_at as string).getTime(),
    )
  })

  test('a canceled tombstone revision shows status canceled at the current row', async () => {
    const chapter = await makeChapter()
    const director = await makeAccount()
    const eventId = randomUUID()
    await insertRevision({ eventId, chapterId: chapter, version: 1, createdBy: director })
    await insertRevision({
      eventId,
      chapterId: chapter,
      version: 2,
      status: 'canceled',
      createdBy: director,
    })
    const [cur] = await h.sql`
      select status, version from calendar_event_current where event_id = ${eventId}
    `
    expect(cur!.status).toBe('canceled')
    expect(cur!.version).toBe(2)
    // The prior active revision row is retained (append-only): both rows exist.
    const rows = await h.sql`select version from calendar_event where event_id = ${eventId}`
    expect(rows).toHaveLength(2)
  })

  test('only-active filtering: a distinct active event and a canceled one coexist', async () => {
    const chapter = await makeChapter()
    const director = await makeAccount()
    const active = randomUUID()
    const canceled = randomUUID()
    await insertRevision({ eventId: active, chapterId: chapter, createdBy: director })
    await insertRevision({ eventId: canceled, chapterId: chapter, version: 1, createdBy: director })
    await insertRevision({
      eventId: canceled,
      chapterId: chapter,
      version: 2,
      status: 'canceled',
      createdBy: director,
    })
    const rows = await h.sql`
      select event_id from calendar_event_current
      where chapter_id = ${chapter} and status = 'active'
    `
    const ids = rows.map((r) => r.event_id as string)
    expect(ids).toContain(active)
    expect(ids).not.toContain(canceled)
  })
})

// ---------------------------------------------------------------------------
describe('append-only enforcement on calendar_event', () => {
  test('UPDATE is rejected by the trigger (even as owner)', async () => {
    const chapter = await makeChapter()
    const director = await makeAccount()
    const row = await insertRevision({ chapterId: chapter, createdBy: director })
    await expect(
      h.sql`update calendar_event set title = 'Hacked' where id = ${row.id}`,
    ).rejects.toThrow(/append-only/i)
  })

  test('DELETE is rejected by the trigger (even as owner)', async () => {
    const chapter = await makeChapter()
    const director = await makeAccount()
    const row = await insertRevision({ chapterId: chapter, createdBy: director })
    await expect(h.sql`delete from calendar_event where id = ${row.id}`).rejects.toThrow(
      /append-only/i,
    )
  })
})

// ---------------------------------------------------------------------------
describe('Mechanism A: grants on calendar_event', () => {
  test('app may SELECT/INSERT but not UPDATE/DELETE', async () => {
    const chapter = await makeChapter()
    const director = await makeAccount()
    const app = h.connectAs('curiolab_app', 'app_pw')
    const rows = await app`
      insert into calendar_event (
        event_id, chapter_id, version, status, title, kind, starts_at, ends_at,
        audiences, created_by_account_id
      ) values (
        ${randomUUID()}, ${chapter}, 1, 'active', 'Session', 'session',
        '2099-10-03T14:00:00Z', '2099-10-03T16:00:00Z',
        ${['mentor']}::calendar_audience[], ${director}
      ) returning id
    `
    expect(rows.length).toBe(1)
    const read = await app`select id from calendar_event where id = ${rows[0]!.id}`
    expect(read.length).toBe(1)
    await expect(
      app`update calendar_event set title = 'x' where id = ${rows[0]!.id}`,
    ).rejects.toThrow(/permission denied|append-only/i)
    await expect(app`delete from calendar_event where id = ${rows[0]!.id}`).rejects.toThrow(
      /permission denied|append-only/i,
    )
  })
})
