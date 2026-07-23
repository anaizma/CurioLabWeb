// -------------------------------------------------------------------------
// Auth controllers (POST /auth/login, /logout, GET /auth/session). Embedded
// Postgres, synthetic data only.
//
// Proves the session lifecycle end to end: login mints an opaque session,
// getSession validates it and returns the AuthContext summary + membership
// switcher, logout revokes it (a subsequent getSession is unauthorized).
// Wrong/absent credentials and tokens are opaque 401s, never 500s.
// -------------------------------------------------------------------------

import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { hashPassword } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeChapter } from './helpers/fixtures.js'
import { login, logout, getSession } from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

async function makeLoginable(email: string, password: string): Promise<string> {
  const hash = await hashPassword(password)
  const [row] = await h.sql`
    insert into account (
      email, legal_name, display_name, date_of_birth, dob_provenance,
      credential_owner, status, maturation_state, password_hash
    ) values (
      ${email}, 'Adult Testperson', 'Adult T.', '1990-01-01', 'staff_entered',
      'self_private', 'active', 'self_managed', ${hash}
    ) returning id
  `
  return row!.id as string
}

describe('login', () => {
  test('correct credentials mint a session that validates', async () => {
    const chapter = await makeChapter(h.sql)
    const acct = await makeLoginable('login-a@example.test', 'correct horse battery')
    await h.sql`
      insert into membership (account_id, chapter_id, role, status)
      values (${acct}, ${chapter}, 'chapter_director', 'active')
    `

    const res = await login({
      sql: h.sql,
      body: { identifier: 'login-a@example.test', password: 'correct horse battery' },
    })
    expect(res.status).toBe(200)
    expect(res.body.accountId).toBe(acct)
    expect(res.session?.token).toBeTruthy()

    // The minted token resolves a session summary with the membership switcher.
    const sess = await getSession({ sql: h.sql, sessionToken: res.session!.token! })
    expect(sess.status).toBe(200)
    expect(sess.body.accountId).toBe(acct)
    expect(sess.body.memberships.some((m) => m.role === 'chapter_director')).toBe(true)
  })

  test('a wrong password is an opaque 401, no session', async () => {
    await makeLoginable('login-b@example.test', 'the-right-one')
    const res = await login({
      sql: h.sql,
      body: { identifier: 'login-b@example.test', password: 'the-wrong-one' },
    })
    expect(res.status).toBe(401)
    expect(res.session).toBeUndefined()
  })

  test('an unknown identifier is an opaque 401', async () => {
    const res = await login({
      sql: h.sql,
      body: { identifier: 'nobody@example.test', password: 'whatever' },
    })
    expect(res.status).toBe(401)
  })

  test('missing fields are a 400, not a 500', async () => {
    const res = await login({ sql: h.sql, body: { identifier: 'x@example.test' } as never })
    expect(res.status).toBe(400)
  })
})

describe('getSession', () => {
  test('no token is a 401', async () => {
    const res = await getSession({ sql: h.sql })
    expect(res.status).toBe(401)
  })
})

describe('logout', () => {
  test('revokes the session; a subsequent getSession is unauthorized', async () => {
    await makeLoginable('login-c@example.test', 'passphrase-c')
    const loggedIn = await login({
      sql: h.sql,
      body: { identifier: 'login-c@example.test', password: 'passphrase-c' },
    })
    const token = loggedIn.session!.token!

    const out = await logout({ sql: h.sql, sessionToken: token })
    expect(out.status).toBe(200)
    // The adapter is told to clear the cookie.
    expect(out.session).toEqual({ token: null })

    // The session row is revoked, so it no longer validates.
    const after = await getSession({ sql: h.sql, sessionToken: token })
    expect(after.status).toBe(401)
  })
})
