// -------------------------------------------------------------------------
// §10 two-step login + TOTP enrollment, end to end through the HTTP controllers.
// Embedded Postgres, synthetic data only.
//
//   POST /api/auth/login          password step -> totpRequired |
//                                 totpEnrollmentRequired | full session
//   POST /api/auth/totp           submit the second factor -> full session
//   POST /api/auth/totp/enroll    begin forced enrollment -> secret + URI
//   POST /api/auth/totp/confirm   confirm enrollment -> backup codes + session
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { hashPassword, totp, validateSession } from '@curiolab/runtime'
import { TwoFactorService } from '@curiolab/app'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeChapter } from './helpers/fixtures.js'
import {
  login,
  submitTotp,
  beginTotpEnrollment,
  confirmTotpEnrollment,
  getSession,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

const PW = 'correct horse battery staple'

/** A privileged (chapter_director) account with a password, in a fresh chapter. */
async function makeDirector(email: string): Promise<{ accountId: string; chapter: string }> {
  const chapter = await makeChapter(h.sql)
  const hash = await hashPassword(PW)
  const [row] = await h.sql`
    insert into account (
      email, legal_name, display_name, date_of_birth, dob_provenance,
      credential_owner, status, maturation_state, password_hash
    ) values (
      ${email}, 'Director Testperson', 'Director T.', '1980-01-01', 'staff_entered',
      'self_private', 'active', 'self_managed', ${hash}
    ) returning id
  `
  const accountId = row!.id as string
  await h.sql`
    insert into membership (account_id, chapter_id, role, status)
    values (${accountId}, ${chapter}, 'chapter_director', 'active')
  `
  return { accountId, chapter }
}

describe('a student (non-privileged) is password-only', () => {
  test('login mints a session directly, no second factor', async () => {
    const chapter = await makeChapter(h.sql)
    const hash = await hashPassword(PW)
    const [row] = await h.sql`
      insert into account (
        username, legal_name, display_name, date_of_birth, dob_provenance, dob_source_ref,
        credential_owner, status, maturation_state, password_hash
      ) values (
        ${`curio-${randomUUID().slice(0, 8)}`}, 'Minor Testchild', 'Minor T.', '2014-01-01',
        'enrollment_record', ${randomUUID()}, 'guardian_provisioned', 'active', 'minor', ${hash}
      ) returning id
    `
    const student = row!.id as string
    await h.sql`
      insert into membership (account_id, chapter_id, role, status)
      values (${student}, ${chapter}, 'student', 'active')
    `
    const identifier = (await h.sql`select username from account where id = ${student}`)[0]!.username as string
    const res = await login({ sql: h.sql, body: { identifier, password: PW } })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ accountId: student })
    expect(res.session?.token).toBeTruthy()
  })
})

describe('privileged first login: forced enrollment', () => {
  test('login -> totpEnrollmentRequired -> enroll -> confirm mints the session + backup codes', async () => {
    const email = `dir-${randomUUID().slice(0, 8)}@example.test`
    const { accountId } = await makeDirector(email)
    const now = new Date('2026-07-24T12:00:00Z')

    // Step 1: password only -> enrollment required, NO session.
    const step1 = await login({ sql: h.sql, body: { identifier: email, password: PW }, now })
    expect(step1.body).toMatchObject({ totpEnrollmentRequired: true })
    expect(step1.session).toBeUndefined()
    const pendingToken = (step1.body as { pendingToken: string }).pendingToken

    // Step 2: begin enrollment -> secret + otpauth URI, still no session.
    const begin = await beginTotpEnrollment({ sql: h.sql, body: { pendingToken }, now })
    expect(begin.status).toBe(200)
    const secret = begin.body.secret
    expect(begin.body.otpauthUri).toContain('otpauth://totp/')

    // Step 3: confirm with the current code -> session + backup codes ONCE.
    const code = totp(secret, now.getTime())
    const confirm = await confirmTotpEnrollment({ sql: h.sql, body: { pendingToken, code }, now })
    expect(confirm.status).toBe(200)
    expect(confirm.body.accountId).toBe(accountId)
    expect(confirm.body.backupCodes).toHaveLength(10)
    expect(confirm.session?.token).toBeTruthy()

    const sess = await getSession({ sql: h.sql, sessionToken: confirm.session!.token! })
    expect(sess.status).toBe(200)
    expect(sess.body.accountId).toBe(accountId)

    // The pending token is consumed — it cannot begin a second enrollment.
    const reuse = await beginTotpEnrollment({ sql: h.sql, body: { pendingToken }, now })
    expect(reuse.status).toBe(401)
  })

  test('a wrong confirm code is an opaque 401 and does not activate', async () => {
    const email = `dir-${randomUUID().slice(0, 8)}@example.test`
    await makeDirector(email)
    const now = new Date('2026-07-24T12:00:00Z')
    const step1 = await login({ sql: h.sql, body: { identifier: email, password: PW }, now })
    const pendingToken = (step1.body as { pendingToken: string }).pendingToken
    await beginTotpEnrollment({ sql: h.sql, body: { pendingToken }, now })
    const confirm = await confirmTotpEnrollment({ sql: h.sql, body: { pendingToken, code: '000000' }, now })
    expect(confirm.status).toBe(401)
    expect(confirm.session).toBeUndefined()
  })
})

describe('privileged login with active TOTP', () => {
  async function enrolledDirector(email: string, now: Date): Promise<{ accountId: string; secret: string }> {
    const { accountId } = await makeDirector(email)
    const two = new TwoFactorService({ sql: h.sql })
    const { secret } = await two.beginEnrollment(accountId, { now })
    await two.confirmEnrollment(accountId, totp(secret, now.getTime()), { now })
    return { accountId, secret }
  }

  test('password alone yields totpRequired + no session; a correct code mints the session', async () => {
    const email = `dir-${randomUUID().slice(0, 8)}@example.test`
    const now = new Date('2026-07-24T12:00:00Z')
    const { accountId, secret } = await enrolledDirector(email, now)

    const later = new Date(now.getTime() + 60_000)
    const step1 = await login({ sql: h.sql, body: { identifier: email, password: PW }, now: later })
    expect(step1.status).toBe(200)
    expect(step1.body).toMatchObject({ totpRequired: true })
    expect(step1.session).toBeUndefined()
    const pendingToken = (step1.body as { pendingToken: string }).pendingToken

    const submit = await submitTotp({
      sql: h.sql,
      body: { pendingToken, code: totp(secret, later.getTime()) },
      now: later,
    })
    expect(submit.status).toBe(200)
    expect(submit.body.accountId).toBe(accountId)
    expect(submit.session?.token).toBeTruthy()
    const vs = await validateSession(h.sql, submit.session!.token!, later)
    expect(vs!.accountId).toBe(accountId)

    // A 2FA-gated login is recorded in the access ledger.
    const led = await h.sql`select event from access_ledger where subject_account_id = ${accountId} and event = 'login.two_factor'`
    expect(led).toHaveLength(1)
  })

  test('a wrong TOTP code is an opaque 401, no session', async () => {
    const email = `dir-${randomUUID().slice(0, 8)}@example.test`
    const now = new Date('2026-07-24T12:00:00Z')
    await enrolledDirector(email, now)
    const later = new Date(now.getTime() + 60_000)
    const step1 = await login({ sql: h.sql, body: { identifier: email, password: PW }, now: later })
    const pendingToken = (step1.body as { pendingToken: string }).pendingToken
    const submit = await submitTotp({ sql: h.sql, body: { pendingToken, code: '999999' }, now: later })
    expect(submit.status).toBe(401)
    expect(submit.session).toBeUndefined()
  })

  test('too many wrong codes rate-limit the submit (429)', async () => {
    const email = `dir-${randomUUID().slice(0, 8)}@example.test`
    const now = new Date('2026-07-24T12:00:00Z')
    const { secret } = await enrolledDirector(email, now)
    const later = new Date(now.getTime() + 60_000)
    const step1 = await login({ sql: h.sql, body: { identifier: email, password: PW }, now: later })
    const pendingToken = (step1.body as { pendingToken: string }).pendingToken
    for (let i = 0; i < 5; i++) {
      const r = await submitTotp({ sql: h.sql, body: { pendingToken, code: '111111' }, now: later })
      expect(r.status).toBe(401)
    }
    // The 6th is refused even with a correct code.
    const r6 = await submitTotp({
      sql: h.sql,
      body: { pendingToken, code: totp(secret, later.getTime()) },
      now: later,
    })
    expect(r6.status).toBe(429)
  })
})

// The bootstrapped-platform-admin login flow (forced password change +
// TOTP) moved to its own file (bootstrap-admin-login-flow.test.ts) with an
// isolated harness: bootstrapPlatformAdmin's non-empty-database guard means
// it can only run against a database with no account rows yet, which this
// file's shared DB no longer is by the time earlier describe blocks above
// have run.
