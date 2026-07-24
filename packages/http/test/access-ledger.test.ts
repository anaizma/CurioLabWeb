// -------------------------------------------------------------------------
// admin/director backend §8/§9 HTTP controllers — the mentor/director-assisted
// minor recovery and the append-only access-ledger read. Embedded Postgres.
//
//   POST /api/ops/accounts/:id/assist-recovery   account.assist_recovery
//   GET  /api/ops/access-ledger                   ledger.read (chapter-scoped)
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { createSession } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeApplication, makeEnrollment } from './helpers/fixtures.js'
import { seedDirector, type DirectorSeed } from './helpers/seed.js'
import { assistRecovery, readAccessLedger } from '../src/index.js'

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

async function seedMinor(d: DirectorSeed): Promise<string> {
  const [row] = await h.sql`
    insert into account (
      username, legal_name, display_name, date_of_birth, dob_provenance,
      dob_source_ref, credential_owner, status, maturation_state
    ) values (
      ${`curio-${randomUUID().slice(0, 8)}`}, 'Minor Lastname', 'Minor L.', '2014-01-01',
      'enrollment_record', ${randomUUID()}, 'guardian_provisioned', 'active', 'minor'
    ) returning id
  `
  const student = row!.id as string
  const applicationId = await makeApplication(h.sql, d.chapter, `parent-${randomUUID().slice(0, 8)}@example.test`)
  await makeEnrollment(h.sql, {
    applicationId,
    chapterId: d.chapter,
    termId: d.term,
    createdBy: d.director,
    studentAccountId: student,
    dateOfBirth: null,
  })
  return student
}

describe('assistRecovery (POST /api/ops/accounts/:id/assist-recovery)', () => {
  test('a director mints a guardian-routed token and the ledger records it with the IP', async () => {
    const d = await seedDirector(h.sql)
    const student = await seedMinor(d)
    const res = await assistRecovery({
      sql: h.sql,
      sessionToken: d.directorToken,
      params: { id: student },
      clientIp: '203.0.113.55',
    })
    expect(res.status).toBe(200)
    expect(res.body.route).toBe('guardian')
    expect(res.body.token).toBeTruthy()

    const rows = await h.sql`
      select actor_account_id, client_ip from access_ledger
      where event = 'recovery.mentor_assisted' and subject_account_id = ${student}
    `
    expect(rows).toHaveLength(1)
    expect(rows[0]!.actor_account_id).toBe(d.director)
    expect(String(rows[0]!.client_ip)).toBe('203.0.113.55')
  })

  test('a non-teaching outsider is 403 and writes nothing', async () => {
    const d = await seedDirector(h.sql)
    const student = await seedMinor(d)
    const outsider = await makeAdult(h.sql)
    const res = await assistRecovery({
      sql: h.sql,
      sessionToken: await sessionFor(outsider),
      params: { id: student },
    })
    expect(res.status).toBe(403)
    const [n] = await h.sql`select count(*)::int as n from access_ledger where subject_account_id = ${student}`
    expect(n!.n).toBe(0)
  })
})

describe('readAccessLedger (GET /api/ops/access-ledger)', () => {
  test('a director reads their chapter ledger; minor display names, never raw last names', async () => {
    const d = await seedDirector(h.sql)
    const student = await seedMinor(d)
    await assistRecovery({
      sql: h.sql,
      sessionToken: d.directorToken,
      params: { id: student },
      clientIp: '198.51.100.9',
    })

    const res = await readAccessLedger({ sql: h.sql, sessionToken: d.directorToken })
    expect(res.status).toBe(200)
    expect(res.body.chapterId).toBe(d.chapter)
    const row = res.body.items.find((i) => i.event === 'recovery.mentor_assisted')
    expect(row).toBeDefined()
    expect(row!.subjectDisplayName).toBe('Minor L.') // first-name + last-initial display
    // No raw last name and no stored IP leak in the ops read.
    expect(JSON.stringify(res.body)).not.toMatch(/Lastname/)
    expect(JSON.stringify(res.body)).not.toMatch(/198\.51\.100\.9/)
  })

  test('a director of another chapter is 403 (out of scope); a null session is 403', async () => {
    const d = await seedDirector(h.sql)
    const other = await seedDirector(h.sql)
    const cross = await readAccessLedger({
      sql: h.sql,
      sessionToken: other.directorToken,
      query: { chapterId: d.chapter },
    })
    expect(cross.status).toBe(403)
    const anon = await readAccessLedger({ sql: h.sql, sessionToken: null })
    expect(anon.status).toBe(403)
  })
})
