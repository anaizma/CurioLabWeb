// -------------------------------------------------------------------------
// Account-lifecycle ops controllers (maturation confirm, reissue-setup, the 16+
// self_private transition) and the audit readers. Embedded Postgres, synthetic
// data only.
//
//   POST /api/ops/maturations/:id/confirm      maturation.confirm (director)
//   POST /api/ops/accounts/:id/reissue-setup   account.recover (director)
//   POST /api/ops/students/:id/self-private     16+ witnessed (self session)
//   GET  /api/ops/audit                          chapter-scoped read, logs audit.read
//   GET  /api/admin/audit                        global read (platform_admin)
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { createSession } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import {
  makeAdult,
  makeApplication,
  makeEnrollment,
  makeMembership,
} from './helpers/fixtures.js'
import { seedDirector, type DirectorSeed } from './helpers/seed.js'
import {
  confirmMaturation,
  reissueSetup,
  selfPrivate,
  readOpsAudit,
  readAdminAudit,
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

/** A student account enrolled in the director's chapter, with a given maturation state. */
async function seedEnrolledStudent(
  d: DirectorSeed,
  opts: {
    dateOfBirth: string
    maturationState?: 'minor' | 'maturation_pending' | 'self_managed'
    credentialOwner?: 'guardian_provisioned' | 'self_private'
  },
): Promise<string> {
  const [row] = await h.sql`
    insert into account (
      username, legal_name, display_name, date_of_birth, dob_provenance,
      dob_source_ref, credential_owner, status, maturation_state
    ) values (
      ${`curio-${randomUUID().slice(0, 8)}`}, 'Minor Testchild', 'Minor T.', ${opts.dateOfBirth},
      'enrollment_record', ${randomUUID()}, ${opts.credentialOwner ?? 'guardian_provisioned'},
      'active', ${opts.maturationState ?? 'minor'}
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

describe('confirmMaturation (POST /api/ops/maturations/:id/confirm)', () => {
  test('a director advances maturation and lapses the verified edge', async () => {
    const d = await seedDirector(h.sql)
    const student = await seedEnrolledStudent(d, {
      dateOfBirth: '2005-01-01',
      maturationState: 'maturation_pending',
    })
    // A verified guardianship edge that the confirmation must lapse.
    const guardian = await makeAdult(h.sql)
    const [edge] = await h.sql`
      insert into guardianship (
        guardian_account_id, student_account_id, relationship, status,
        verification_method, verified_by, source_ref, verified_at
      ) values (
        ${guardian}, ${student}, 'guardian', 'verified', 'signed_form_match',
        ${d.director}, ${randomUUID()}, now()
      ) returning id
    `

    const res = await confirmMaturation({
      sql: h.sql,
      sessionToken: d.directorToken,
      params: { id: student },
    })
    expect(res.status).toBe(200)
    expect(res.body.edgesLapsed).toBe(1)

    const [acct] = await h.sql`select maturation_state from account where id = ${student}`
    expect(acct!.maturation_state).toBe('self_managed')
    const [g] = await h.sql`select status from guardianship where id = ${edge!.id}`
    expect(g!.status).toBe('lapsed')
  })

  test('a non-director is 403', async () => {
    const d = await seedDirector(h.sql)
    const student = await seedEnrolledStudent(d, {
      dateOfBirth: '2005-01-01',
      maturationState: 'maturation_pending',
    })
    const outsider = await makeAdult(h.sql)
    const res = await confirmMaturation({
      sql: h.sql,
      sessionToken: await sessionFor(outsider),
      params: { id: student },
    })
    expect(res.status).toBe(403)
    const [acct] = await h.sql`select maturation_state from account where id = ${student}`
    expect(acct!.maturation_state).toBe('maturation_pending') // unchanged
  })
})

describe('reissueSetup (POST /api/ops/accounts/:id/reissue-setup)', () => {
  test('a director reissues setup for a former student with no active membership (token)', async () => {
    const d = await seedDirector(h.sql)
    const former = await seedEnrolledStudent(d, {
      dateOfBirth: '2000-01-01',
      maturationState: 'self_managed',
    })
    const res = await reissueSetup({
      sql: h.sql,
      sessionToken: d.directorToken,
      params: { id: former },
    })
    expect(res.status).toBe(200)
    expect(res.body.token).toBeTruthy()
    const recover = await h.sql`
      select 1 from audit_entry where action = 'account.recover' and subject_id = ${former}
    `
    expect(recover).toHaveLength(1)
  })

  test('reissue is rejected against an account with an active membership', async () => {
    const d = await seedDirector(h.sql)
    const active = await seedEnrolledStudent(d, {
      dateOfBirth: '2000-01-01',
      maturationState: 'self_managed',
    })
    await makeMembership(h.sql, active, d.chapter, { role: 'student', status: 'active' })
    const res = await reissueSetup({
      sql: h.sql,
      sessionToken: d.directorToken,
      params: { id: active },
    })
    expect(res.status).toBe(409)
  })
})

describe('selfPrivate (POST /api/ops/students/:id/self-private)', () => {
  test('a 16+ student privatizes with a non-guardian chapter witness present', async () => {
    const d = await seedDirector(h.sql)
    const student = await seedEnrolledStudent(d, {
      dateOfBirth: '2009-01-01', // 17 on 2026-07
      maturationState: 'minor',
      credentialOwner: 'guardian_provisioned',
    })
    // An adult, active, non-guardian teaching membership in the chapter.
    const witness = await makeAdult(h.sql)
    await makeMembership(h.sql, witness, d.chapter, { role: 'lead_instructor', status: 'active' })

    const res = await selfPrivate({
      sql: h.sql,
      sessionToken: await sessionFor(student),
      params: { id: student },
      body: { witnessedBy: witness },
    })
    expect(res.status).toBe(200)
    expect(res.body.credentialOwner).toBe('self_private')
    expect(res.body.passwordResetRoute).toBe('chapter_director')
    const [acct] = await h.sql`select credential_owner from account where id = ${student}`
    expect(acct!.credential_owner).toBe('self_private')
  })

  test('a privatization without a witness is a 400', async () => {
    const d = await seedDirector(h.sql)
    const student = await seedEnrolledStudent(d, {
      dateOfBirth: '2009-01-01',
      maturationState: 'minor',
      credentialOwner: 'guardian_provisioned',
    })
    const res = await selfPrivate({
      sql: h.sql,
      sessionToken: await sessionFor(student),
      params: { id: student },
      body: {},
    })
    expect(res.status).toBe(400)
  })
})

describe('readOpsAudit (GET /api/ops/audit)', () => {
  test("a director reads their chapter's audit; exactly one audit.read row is written", async () => {
    const d = await seedDirector(h.sql)
    await h.sql`
      insert into audit_entry (actor_account_id, action, subject_type, subject_id, chapter_id)
      values (${d.director}, 'test.seeded', 'account', ${d.director}, ${d.chapter})
    `
    const res = await readOpsAudit({ sql: h.sql, sessionToken: d.directorToken })
    expect(res.status).toBe(200)
    expect(res.body.chapterId).toBe(d.chapter)
    expect(res.body.entries.some((e) => e.action === 'test.seeded')).toBe(true)

    const reads = await h.sql`
      select 1 from audit_entry where action = 'audit.read' and actor_account_id = ${d.director}
    `
    expect(reads).toHaveLength(1)
  })

  test('a non-authorized caller is 403 and writes no audit.read', async () => {
    const d = await seedDirector(h.sql)
    const outsider = await makeAdult(h.sql)
    await makeMembership(h.sql, outsider, d.chapter, { role: 'comms_associate', status: 'active' })
    const res = await readOpsAudit({ sql: h.sql, sessionToken: await sessionFor(outsider) })
    expect(res.status).toBe(403)
    const reads = await h.sql`
      select 1 from audit_entry where action = 'audit.read' and actor_account_id = ${outsider}
    `
    expect(reads).toHaveLength(0)
  })
})

describe('readAdminAudit (GET /api/admin/audit)', () => {
  test('a platform_admin reads the global audit; a director is 403', async () => {
    const d = await seedDirector(h.sql)
    await h.sql`
      insert into audit_entry (actor_account_id, action, subject_type, chapter_id)
      values (${d.director}, 'test.global', 'account', ${d.chapter})
    `
    const admin = await makeAdult(h.sql)
    await makeMembership(h.sql, admin, d.chapter, { role: 'platform_admin', status: 'active' })

    const ok = await readAdminAudit({ sql: h.sql, sessionToken: await sessionFor(admin) })
    expect(ok.status).toBe(200)
    expect(ok.body.entries.length).toBeGreaterThan(0)

    const denied = await readAdminAudit({ sql: h.sql, sessionToken: d.directorToken })
    expect(denied.status).toBe(403)
  })
})
