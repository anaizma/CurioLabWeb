// -------------------------------------------------------------------------
// guardian/director portal work order, Feature 2 — attendance & make-up
// check-ins, as an APPEND-ONLY event-sourced log (migration 0027_attendance.sql).
//
// The additive migration models the attendance exception as an append-only
// revision log: one row per (exception, revision), with a stable `exception_id`
// across revisions, a `version`, a `type` (absent|late), the make-up fields
// (makeup_consent, makeup_slots[], makeup_status), and the guardian/time of that
// revision. A make-up COMPLETION is a NEW row (status -> completed), never a
// destructive UPDATE. A current-state projection view `attendance_exception_current`
// picks the LATEST revision per exception_id and carries the ORIGINAL creator/
// created_at forward. Mirrors the calendar_event / consent_grant pattern (0024/0026)
// — an edit or completion is a NEW row — so it composes with the SAME
// reject_append_only_mutation() trigger + role REVOKE.
//
// The red-before-green witnesses:
//   * attendance_exception exists; the type / makeup_status enums; account fks;
//     makeup_slots is a timestamptz ARRAY;
//   * the "late carries no make-up" and "absent has a make-up status" CHECKs bite;
//   * append-only (UPDATE/DELETE rejected by the trigger + role REVOKE);
//   * attendance_exception_current reflects the latest revision per exception_id, a
//     completion revision supersedes, and created_by/created_at stay the ORIGINAL;
//   * Mechanism-A grants: app may SELECT/INSERT (not UPDATE/DELETE).
//
// TDD: run with CURIOLAB_MIGRATE_UPTO=0026 to witness these fail (the relations do
// not exist yet); the default run applies 0027 and they pass.
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
      ${`person-${randomUUID().slice(0, 8)}@example.test`}, ${null}, 'Adult Testperson', 'Adult T.',
      '1990-01-01', 'staff_entered', ${null}, 'self_private', 'active', 'self_managed'
    ) returning id
  `
  return row!.id as string
}

/** Insert one attendance_exception revision row; returns the row. */
async function insertRevision(o: {
  exceptionId?: string
  studentAccountId: string
  sessionEventId?: string
  version?: number
  type?: string
  reason?: string | null
  arriveAt?: string | null
  makeupConsent?: boolean
  makeupSlots?: string[]
  makeupStatus?: string | null
  createdBy: string
}) {
  const exceptionId = o.exceptionId ?? randomUUID()
  const slots = o.makeupSlots ?? []
  const type = o.type ?? 'absent'
  // Sensible defaults so a bare absent insert satisfies the CHECKs.
  const makeupStatus =
    o.makeupStatus === undefined ? (type === 'absent' ? 'scheduled' : null) : o.makeupStatus
  const [row] = await h.sql`
    insert into attendance_exception (
      exception_id, student_account_id, session_event_id, version, type, reason,
      arrive_at, makeup_consent, makeup_slots, makeup_status,
      created_by_guardian_account_id
    ) values (
      ${exceptionId}, ${o.studentAccountId}, ${o.sessionEventId ?? randomUUID()},
      ${o.version ?? 1}, ${type}, ${o.reason ?? null}, ${o.arriveAt ?? null},
      ${o.makeupConsent ?? (type === 'absent')}, ${slots}::timestamptz[], ${makeupStatus},
      ${o.createdBy}
    ) returning id, exception_id, seq, version, type, makeup_slots, makeup_status,
                created_by_guardian_account_id, created_at
  `
  return row!
}

// ---------------------------------------------------------------------------
describe('attendance_exception shape and enums', () => {
  test('a v1 absent row inserts with type, slots[], status, exception_id + seq', async () => {
    const student = await makeAccount()
    const guardian = await makeAccount()
    const row = await insertRevision({
      studentAccountId: student,
      createdBy: guardian,
      makeupSlots: ['2099-10-04T18:00:00Z'],
    })
    expect(row.id).toBeTruthy()
    expect(row.exception_id).toBeTruthy()
    expect(row.seq).toBeTruthy()
    expect(row.version).toBe(1)
    expect(row.type).toBe('absent')
    expect(row.makeup_status).toBe('scheduled')
    expect(row.created_by_guardian_account_id).toBe(guardian)
    expect(row.created_at).not.toBeNull()
  })

  test('type is a checked enum: garbage is rejected', async () => {
    const student = await makeAccount()
    const guardian = await makeAccount()
    await expect(
      insertRevision({ studentAccountId: student, createdBy: guardian, type: 'tardy' }),
    ).rejects.toThrow(/invalid input value for enum/i)
  })

  test('makeup_status is a checked enum: a bad value is rejected', async () => {
    const student = await makeAccount()
    const guardian = await makeAccount()
    await expect(
      insertRevision({
        studentAccountId: student,
        createdBy: guardian,
        makeupStatus: 'done',
      }),
    ).rejects.toThrow(/invalid input value for enum/i)
  })

  test('both types are accepted', async () => {
    const student = await makeAccount()
    const guardian = await makeAccount()
    const absent = await insertRevision({ studentAccountId: student, createdBy: guardian })
    expect(absent.type).toBe('absent')
    const late = await insertRevision({
      studentAccountId: student,
      createdBy: guardian,
      type: 'late',
      arriveAt: '2099-10-03T14:15:00Z',
      makeupStatus: null,
    })
    expect(late.type).toBe('late')
    expect(late.makeup_status).toBeNull()
  })

  test('student + guardian fks are checked', async () => {
    const guardian = await makeAccount()
    await expect(
      insertRevision({ studentAccountId: randomUUID(), createdBy: guardian }),
    ).rejects.toThrow(/foreign key|violates/i)
  })
})

// ---------------------------------------------------------------------------
describe('attendance_exception CHECK constraints', () => {
  test('a late exception cannot carry a make-up status or slots', async () => {
    const student = await makeAccount()
    const guardian = await makeAccount()
    // late + a make-up status is rejected.
    await expect(
      insertRevision({
        studentAccountId: student,
        createdBy: guardian,
        type: 'late',
        makeupStatus: 'scheduled',
      }),
    ).rejects.toThrow(/check|violates/i)
    // late + non-empty slots is rejected.
    await expect(
      insertRevision({
        studentAccountId: student,
        createdBy: guardian,
        type: 'late',
        makeupStatus: null,
        makeupSlots: ['2099-10-04T18:00:00Z'],
      }),
    ).rejects.toThrow(/check|violates/i)
  })

  test('an absent exception must carry a make-up status', async () => {
    const student = await makeAccount()
    const guardian = await makeAccount()
    await expect(
      insertRevision({
        studentAccountId: student,
        createdBy: guardian,
        type: 'absent',
        makeupStatus: null,
      }),
    ).rejects.toThrow(/check|violates/i)
  })
})

// ---------------------------------------------------------------------------
describe('attendance_exception_current projection', () => {
  test('shows the latest revision per exception_id; created_by/created_at are the original', async () => {
    const student = await makeAccount()
    const guardian = await makeAccount()
    const resolver = await makeAccount()
    const exceptionId = randomUUID()
    const session = randomUUID()
    const v1 = await insertRevision({
      exceptionId,
      studentAccountId: student,
      sessionEventId: session,
      version: 1,
      makeupStatus: 'scheduled',
      makeupSlots: ['2099-10-04T18:00:00Z'],
      createdBy: guardian,
    })
    // A completion is a NEW row (status -> completed), authored by staff.
    await insertRevision({
      exceptionId,
      studentAccountId: student,
      sessionEventId: session,
      version: 2,
      makeupStatus: 'completed',
      makeupSlots: ['2099-10-04T18:00:00Z'],
      createdBy: resolver,
    })
    const [cur] = await h.sql`
      select exception_id, version, type, makeup_status,
             created_by_guardian_account_id, created_at
      from attendance_exception_current where exception_id = ${exceptionId}
    `
    expect(cur!.version).toBe(2)
    expect(cur!.makeup_status).toBe('completed')
    // The exception's creator/createdAt are the ORIGINAL v1 values, not the resolver's.
    expect(cur!.created_by_guardian_account_id).toBe(guardian)
    expect(new Date(cur!.created_at as string).getTime()).toBe(
      new Date(v1.created_at as string).getTime(),
    )
  })
})

// ---------------------------------------------------------------------------
describe('append-only enforcement on attendance_exception', () => {
  test('UPDATE is rejected by the trigger (even as owner)', async () => {
    const student = await makeAccount()
    const guardian = await makeAccount()
    const row = await insertRevision({ studentAccountId: student, createdBy: guardian })
    await expect(
      h.sql`update attendance_exception set makeup_status = 'completed' where id = ${row.id}`,
    ).rejects.toThrow(/append-only/i)
  })

  test('DELETE is rejected by the trigger (even as owner)', async () => {
    const student = await makeAccount()
    const guardian = await makeAccount()
    const row = await insertRevision({ studentAccountId: student, createdBy: guardian })
    await expect(
      h.sql`delete from attendance_exception where id = ${row.id}`,
    ).rejects.toThrow(/append-only/i)
  })
})

// ---------------------------------------------------------------------------
describe('Mechanism A: grants on attendance_exception', () => {
  test('app may SELECT/INSERT but not UPDATE/DELETE', async () => {
    const student = await makeAccount()
    const guardian = await makeAccount()
    const app = h.connectAs('curiolab_app', 'app_pw')
    const rows = await app`
      insert into attendance_exception (
        exception_id, student_account_id, session_event_id, version, type,
        makeup_consent, makeup_slots, makeup_status, created_by_guardian_account_id
      ) values (
        ${randomUUID()}, ${student}, ${randomUUID()}, 1, 'absent',
        true, ${['2099-10-04T18:00:00Z']}::timestamptz[], 'scheduled', ${guardian}
      ) returning id
    `
    expect(rows.length).toBe(1)
    const read = await app`select id from attendance_exception where id = ${rows[0]!.id}`
    expect(read.length).toBe(1)
    await expect(
      app`update attendance_exception set makeup_status = 'completed' where id = ${rows[0]!.id}`,
    ).rejects.toThrow(/permission denied|append-only/i)
    await expect(
      app`delete from attendance_exception where id = ${rows[0]!.id}`,
    ).rejects.toThrow(/permission denied|append-only/i)
  })
})
