// -------------------------------------------------------------------------
// M1 auth-surface controllers (05-api-surface.md "Auth"). Embedded Postgres,
// synthetic data only.
//
//   POST   /api/auth/password/reset-request  uniform response, no existence oracle
//   POST   /api/auth/email/add               self, 18+ maturation add-email
//   POST   /api/auth/impersonate             platform_admin only; read-only for a minor
//   DELETE /api/auth/impersonate             ends the impersonation session
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { createSession, validateSession } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeChapter, makeAdult, makeMinor } from './helpers/fixtures.js'
import { seedDirector } from './helpers/seed.js'
import {
  requestPasswordReset,
  addEmail,
  startImpersonation,
  endImpersonation,
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

/** A platform_admin account with an active membership and a live session token. */
async function seedPlatformAdmin(): Promise<{ admin: string; token: string; chapter: string }> {
  const chapter = await makeChapter(h.sql)
  const admin = await makeAdult(h.sql)
  await h.sql`
    insert into membership (account_id, chapter_id, role, status)
    values (${admin}, ${chapter}, 'platform_admin', 'active')
  `
  return { admin, token: await sessionFor(admin), chapter }
}

describe('requestPasswordReset (POST /api/auth/password/reset-request)', () => {
  test('response is byte-identical for an existing vs a non-existing identifier', async () => {
    const email = `reset-${randomUUID().slice(0, 8)}@example.test`
    await makeAdult(h.sql, { email })

    const existing = await requestPasswordReset({ sql: h.sql, body: { identifier: email } })
    const missing = await requestPasswordReset({
      sql: h.sql,
      body: { identifier: `nobody-${randomUUID().slice(0, 8)}@example.test` },
    })

    expect(existing.status).toBe(missing.status)
    expect(JSON.stringify(existing.body)).toBe(JSON.stringify(missing.body))
    // No account-existence signal in the body.
    expect(JSON.stringify(existing.body)).not.toMatch(/exist|found|unknown|account|guardian|director/i)
  })

  test('routes a self_private account reset to the chapter_director (seam), still uniform', async () => {
    // A minor whose credential is self_private (16+ privatized) routes to the
    // Chapter Director; the seam receives the route, the caller sees the same body.
    const student = await makeMinor(h.sql, { credentialOwner: 'self_private', dateOfBirth: '2009-01-01' })
    const routes: string[] = []
    const res = await requestPasswordReset({
      sql: h.sql,
      body: { identifier: (await h.sql`select username from account where id = ${student}`)[0]!.username as string },
      deliver: (r) => {
        routes.push(r.route)
      },
    })
    expect(res.status).toBe(202)
    expect(routes).toEqual(['chapter_director'])
  })

  test('a missing identifier is a 400, not a 500', async () => {
    const res = await requestPasswordReset({ sql: h.sql, body: {} })
    expect(res.status).toBe(400)
  })
})

describe('addEmail (POST /api/auth/email/add)', () => {
  test('an 18+ minor-state student adds an email -> maturation_pending', async () => {
    const [row] = await h.sql`
      insert into account (
        username, legal_name, display_name, date_of_birth, dob_provenance,
        dob_source_ref, credential_owner, status, maturation_state
      ) values (
        ${`curio-${randomUUID().slice(0, 8)}`}, 'Adult Student', 'Adult S.', '2005-01-01',
        'enrollment_record', ${randomUUID()}, 'guardian_provisioned', 'active', 'minor'
      ) returning id
    `
    const accountId = row!.id as string
    const token = await sessionFor(accountId)
    const email = `matured-${randomUUID().slice(0, 8)}@example.test`

    const res = await addEmail({ sql: h.sql, sessionToken: token, body: { email } })
    expect(res.status).toBe(200)
    expect(res.body.maturationState).toBe('maturation_pending')

    const [acct] = await h.sql`select email, username, maturation_state from account where id = ${accountId}`
    expect(acct!.email).toBe(email)
    expect(acct!.username).toBeNull()
    expect(acct!.maturation_state).toBe('maturation_pending')
  })

  test('an under-18 student cannot add an email (403)', async () => {
    const young = await makeMinor(h.sql, { dateOfBirth: '2015-06-01' })
    const token = await sessionFor(young)
    const res = await addEmail({
      sql: h.sql,
      sessionToken: token,
      body: { email: `x-${randomUUID().slice(0, 8)}@example.test` },
    })
    expect(res.status).toBe(403)
  })
})

describe('startImpersonation / endImpersonation (POST|DELETE /api/auth/impersonate)', () => {
  test('a platform_admin impersonating a MINOR gets a read_only session, both actor fields set', async () => {
    const { admin, token } = await seedPlatformAdmin()
    const minor = await makeMinor(h.sql)
    const now = new Date()

    const res = await startImpersonation({
      sql: h.sql,
      sessionToken: token,
      body: { targetAccountId: minor },
      now,
    })
    expect(res.status).toBe(200)
    const impToken = res.session!.token!
    const vs = await validateSession(h.sql, impToken, now)
    expect(vs).not.toBeNull()
    expect(vs!.impersonatedAccountId).toBe(minor)
    expect(vs!.realActorAccountId).toBe(admin)
    expect(vs!.mode).toBe('read_only')
    // ~30-minute expiry.
    const ttl = vs!.expiresAt.getTime() - now.getTime()
    expect(ttl).toBeGreaterThan(29 * 60_000)
    expect(ttl).toBeLessThanOrEqual(30 * 60_000)
  })

  test('a platform_admin impersonating an ADULT gets a full session', async () => {
    const { token } = await seedPlatformAdmin()
    const adult = await makeAdult(h.sql)
    const res = await startImpersonation({
      sql: h.sql,
      sessionToken: token,
      body: { targetAccountId: adult },
    })
    expect(res.status).toBe(200)
    const vs = await validateSession(h.sql, res.session!.token!)
    expect(vs!.mode).toBe('full')
  })

  test('a non-admin (director) is 403 THROUGH authorize (one permission.denied row now written)', async () => {
    const d = await seedDirector(h.sql)
    const adult = await makeAdult(h.sql)
    const res = await startImpersonation({
      sql: h.sql,
      sessionToken: d.directorToken,
      body: { targetAccountId: adult },
    })
    expect(res.status).toBe(403)
    // The single-code-path invariant: the deny flows through `authorize`, which
    // writes exactly one reasoned permission.denied row for `impersonation.start`.
    const denied = await h.sql`
      select detail from audit_entry
      where action = 'permission.denied' and actor_account_id = ${d.director}
    `
    expect(denied).toHaveLength(1)
    expect(denied[0]!.detail).toMatchObject({ capability: 'impersonation.start', reason: 'out_of_scope' })
    // No impersonation session was minted.
    expect(res.session).toBeUndefined()
  })

  test('a platform_staff (not admin) is 403: impersonation.start is a write the read-only override does not cover', async () => {
    const { chapter } = await seedDirector(h.sql)
    const staff = await makeAdult(h.sql)
    await h.sql`
      insert into membership (account_id, chapter_id, role, status)
      values (${staff}, ${chapter}, 'platform_staff', 'active')
    `
    const target = await makeAdult(h.sql)
    const res = await startImpersonation({
      sql: h.sql,
      sessionToken: await sessionFor(staff),
      body: { targetAccountId: target },
    })
    expect(res.status).toBe(403)
    const denied = await h.sql`
      select detail from audit_entry
      where action = 'permission.denied' and actor_account_id = ${staff}
    `
    expect(denied).toHaveLength(1)
    expect(denied[0]!.detail).toMatchObject({ capability: 'impersonation.start' })
  })

  test('DELETE ends the impersonation session', async () => {
    const { token } = await seedPlatformAdmin()
    const adult = await makeAdult(h.sql)
    const started = await startImpersonation({
      sql: h.sql,
      sessionToken: token,
      body: { targetAccountId: adult },
    })
    const impToken = started.session!.token!

    const ended = await endImpersonation({ sql: h.sql, sessionToken: impToken })
    expect(ended.status).toBe(200)
    expect(ended.session).toEqual({ token: null })
    expect(await validateSession(h.sql, impToken)).toBeNull()
  })
})
