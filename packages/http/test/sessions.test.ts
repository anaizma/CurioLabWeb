// -------------------------------------------------------------------------
// Session lifetime, new-device recognition, and session self-management,
// end to end through the HTTP controllers. Embedded Postgres, synthetic data.
//
//   - a PRIVILEGED session is short-lived; an unprivileged one is not
//   - a sign-in from an unfamiliar device notifies the owner, and one from a
//     familiar device does not
//   - GET  /api/auth/sessions          the caller's own live sessions
//   - POST /api/auth/sessions/revoke   one, or all ("sign out everywhere")
//   - POST /api/auth/sessions/revoke-link  the "this wasn't me" email link
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { hashPassword, totp, validateSession } from '@curiolab/runtime'
import { TwoFactorService } from '@curiolab/app'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeChapter } from './helpers/fixtures.js'
import {
  confirmTotpEnrollment,
  listSessions,
  login,
  revokeSessionByLink,
  revokeSessions,
  submitTotp,
  type NewSignInNotice,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

const PW = 'correct horse battery staple'
const CHROME_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const SAFARI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'

/** An adult account with a password and no membership (unprivileged, no 2FA). */
async function makeUnprivileged(): Promise<string> {
  const hash = await hashPassword(PW)
  const [row] = await h.sql`
    insert into account (
      email, legal_name, display_name, date_of_birth, dob_provenance,
      credential_owner, status, maturation_state, password_hash
    ) values (
      ${`guardian-${randomUUID().slice(0, 8)}@example.test`}, 'Guardian Testperson', 'Guardian T.',
      '1980-01-01', 'staff_entered', 'self_private', 'active', 'self_managed', ${hash}
    ) returning id, email
  `
  return row!.email as string
}

/** A chapter_director with TOTP already active, plus a helper to mint a code. */
async function makeDirectorWithTotp(): Promise<{ email: string; accountId: string }> {
  const chapter = await makeChapter(h.sql)
  const hash = await hashPassword(PW)
  const email = `director-${randomUUID().slice(0, 8)}@example.test`
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
  return { email, accountId }
}

/** Drive the two-step login to a full session, returning the session token. */
async function signInDirector(
  email: string,
  accountId: string,
  opts: { userAgent?: string | null; clientIp?: string | null; notify?: (n: NewSignInNotice) => void } = {},
): Promise<string> {
  const first = await login({ sql: h.sql, body: { identifier: email, password: PW } })
  const pendingToken = (first.body as { pendingToken?: string }).pendingToken
  if (pendingToken === undefined) throw new Error('expected a pending 2FA state')

  const [acct] = await h.sql`select totp_secret, totp_activated_at from account where id = ${accountId}`
  const now = new Date()
  if (acct!.totp_activated_at == null) {
    // First sign-in: forced enrollment, which activates TOTP and mints the session.
    const secret = await new TwoFactorService({ sql: h.sql }).beginEnrollment(accountId)
    const res = await confirmTotpEnrollment({
      sql: h.sql,
      body: { pendingToken, code: totp(secret.secret, now.getTime()) },
      userAgent: opts.userAgent ?? null,
      clientIp: opts.clientIp ?? null,
      now,
    })
    return res.session!.token!
  }
  const res = await submitTotp({
    sql: h.sql,
    body: { pendingToken, code: totp(acct!.totp_secret as string, now.getTime()) },
    userAgent: opts.userAgent ?? null,
    clientIp: opts.clientIp ?? null,
    notifyNewSignIn: opts.notify,
    now,
  })
  if (res.session?.token == null) throw new Error(`expected a session, got ${JSON.stringify(res.body)}`)
  return res.session.token
}

// ===========================================================================
describe('session lifetime is shorter for a privileged account', () => {
  test('an unprivileged account keeps the long window', async () => {
    const email = await makeUnprivileged()
    const now = new Date()
    const res = await login({ sql: h.sql, body: { identifier: email, password: PW }, now })
    const ttl = res.session!.expiresAt!.getTime() - now.getTime()
    // 30 days: a student or parent forced to re-authenticate weekly simply stops
    // using the portal.
    expect(ttl).toBe(30 * 24 * 60 * 60 * 1000)
  })

  test('a privileged account gets a much shorter one', async () => {
    const { email, accountId } = await makeDirectorWithTotp()
    // Enroll first (the enrollment confirm also mints a session).
    await signInDirector(email, accountId)

    const now = new Date()
    const first = await login({ sql: h.sql, body: { identifier: email, password: PW }, now })
    const pendingToken = (first.body as { pendingToken: string }).pendingToken
    const [acct] = await h.sql`select totp_secret from account where id = ${accountId}`
    // A fresh step, so the replay guard does not reject the code just used.
    const later = new Date(now.getTime() + 60_000)
    const res = await submitTotp({
      sql: h.sql,
      body: { pendingToken, code: totp(acct!.totp_secret as string, later.getTime()) },
      now: later,
    })
    const ttl = res.session!.expiresAt!.getTime() - later.getTime()
    expect(ttl).toBe(12 * 60 * 60 * 1000)
    // The point of the split: a director's window is far shorter than a parent's.
    expect(ttl).toBeLessThan(30 * 24 * 60 * 60 * 1000)
  })
})

// ===========================================================================
describe('new-device sign-in notification', () => {
  test('the FIRST session of an account is not reported as a new device', async () => {
    // Every device is new at that point, and a notice arriving seconds after
    // someone set their own password teaches people to ignore the real one.
    const email = await makeUnprivileged()
    const seen: NewSignInNotice[] = []
    await login({
      sql: h.sql,
      body: { identifier: email, password: PW },
      userAgent: CHROME_WIN,
      clientIp: '203.0.113.10',
      notifyNewSignIn: (n) => {
        seen.push(n)
      },
    })
    expect(seen).toEqual([])
  })

  test('the same device signing in again does not notify', async () => {
    const email = await makeUnprivileged()
    const args = { userAgent: CHROME_WIN, clientIp: '203.0.113.10' }
    await login({ sql: h.sql, body: { identifier: email, password: PW }, ...args })
    const seen: NewSignInNotice[] = []
    await login({
      sql: h.sql,
      body: { identifier: email, password: PW },
      ...args,
      notifyNewSignIn: (n) => {
        seen.push(n)
      },
    })
    expect(seen).toEqual([])
  })

  test('a DIFFERENT device notifies, with a coarse label, a coarse network and a revoke token', async () => {
    const email = await makeUnprivileged()
    await login({
      sql: h.sql,
      body: { identifier: email, password: PW },
      userAgent: CHROME_WIN,
      clientIp: '203.0.113.10',
    })

    const seen: NewSignInNotice[] = []
    await login({
      sql: h.sql,
      body: { identifier: email, password: PW },
      userAgent: SAFARI_MAC,
      clientIp: '198.51.100.7',
      notifyNewSignIn: (n) => {
        seen.push(n)
      },
    })

    expect(seen).toHaveLength(1)
    expect(seen[0]!.deviceLabel).toBe('Safari on macOS')
    // The NETWORK, never the exact address.
    expect(seen[0]!.ipHint).toBe('198.51.100.0/24')
    expect(seen[0]!.ipHint).not.toContain('.7')
    expect(seen[0]!.revokeToken).toBeTruthy()
  })

  test('the raw user agent and the exact IP are never stored on the session row', async () => {
    const email = await makeUnprivileged()
    await login({
      sql: h.sql,
      body: { identifier: email, password: PW },
      userAgent: CHROME_WIN,
      clientIp: '203.0.113.222',
    })
    const [row] = await h.sql`
      select device_hash, device_label, ip_hint from session
      where account_id = (select id from account where email = ${email})
      order by created_at desc limit 1
    `
    expect(row!.device_label).toBe('Chrome on Windows')
    expect(row!.ip_hint).toBe('203.0.113.0/24')
    expect(row!.device_hash).toMatch(/^[0-9a-f]{64}$/)
    // Nothing on the row is the value the browser sent.
    expect(JSON.stringify(row)).not.toContain('537.36')
    expect(JSON.stringify(row)).not.toContain('203.0.113.222')
  })

  test('the revoke token ends exactly that one session and nothing else', async () => {
    const email = await makeUnprivileged()
    const familiar = await login({
      sql: h.sql,
      body: { identifier: email, password: PW },
      userAgent: CHROME_WIN,
      clientIp: '203.0.113.10',
    })
    const familiarToken = familiar.session!.token!

    const seen: NewSignInNotice[] = []
    const stranger = await login({
      sql: h.sql,
      body: { identifier: email, password: PW },
      userAgent: SAFARI_MAC,
      clientIp: '198.51.100.7',
      notifyNewSignIn: (n) => {
        seen.push(n)
      },
    })
    const strangerToken = stranger.session!.token!

    const res = await revokeSessionByLink({ sql: h.sql, body: { token: seen[0]!.revokeToken } })
    expect(res.status).toBe(200)

    expect(await validateSession(h.sql, strangerToken)).toBeNull()
    // The owner's own device is untouched: a leaked link must not become a
    // denial-of-service against the account.
    expect(await validateSession(h.sql, familiarToken)).not.toBeNull()
  })

  test('a replayed revoke link answers the same way and changes nothing further', async () => {
    const email = await makeUnprivileged()
    await login({ sql: h.sql, body: { identifier: email, password: PW }, userAgent: CHROME_WIN, clientIp: '203.0.113.10' })
    const seen: NewSignInNotice[] = []
    await login({
      sql: h.sql,
      body: { identifier: email, password: PW },
      userAgent: SAFARI_MAC,
      clientIp: '198.51.100.7',
      notifyNewSignIn: (n) => {
        seen.push(n)
      },
    })
    const revokeToken = seen[0]!.revokeToken
    const first = await revokeSessionByLink({ sql: h.sql, body: { token: revokeToken } })
    const second = await revokeSessionByLink({ sql: h.sql, body: { token: revokeToken } })
    // Indistinguishable, so the endpoint cannot be used to probe tokens.
    expect(second.status).toBe(first.status)
    expect(second.body).toEqual(first.body)
  })

  test('an unknown revoke token is indistinguishable from a real one', async () => {
    const res = await revokeSessionByLink({ sql: h.sql, body: { token: `forged-${randomUUID()}` } })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ revoked: true })
  })
})

// ===========================================================================
describe('listing and revoking your own sessions', () => {
  test('an anonymous caller gets the opaque 403, not an empty list', async () => {
    const res = await listSessions({ sql: h.sql, sessionToken: null })
    expect(res.status).toBe(403)
  })

  test('lists only the caller\'s own live sessions, with the current one marked', async () => {
    const email = await makeUnprivileged()
    const a = await login({ sql: h.sql, body: { identifier: email, password: PW }, userAgent: CHROME_WIN, clientIp: '203.0.113.10' })
    const b = await login({ sql: h.sql, body: { identifier: email, password: PW }, userAgent: SAFARI_MAC, clientIp: '198.51.100.7' })
    // A second account's session must not appear in the first account's list.
    const otherEmail = await makeUnprivileged()
    await login({ sql: h.sql, body: { identifier: otherEmail, password: PW } })

    const res = await listSessions({ sql: h.sql, sessionToken: b.session!.token! })
    const sessions = (res.body as { sessions: { id: string; current: boolean; deviceLabel: string | null }[] }).sessions
    expect(sessions).toHaveLength(2)
    expect(sessions.filter((s) => s.current)).toHaveLength(1)
    expect(sessions.find((s) => s.current)!.deviceLabel).toBe('Safari on macOS')
    // Nothing token-shaped is ever returned.
    expect(JSON.stringify(sessions)).not.toContain(a.session!.token!)
    expect(JSON.stringify(sessions)).not.toContain('token')
  })

  test('revoking one session leaves the others alone', async () => {
    const email = await makeUnprivileged()
    const a = await login({ sql: h.sql, body: { identifier: email, password: PW }, userAgent: CHROME_WIN, clientIp: '203.0.113.10' })
    const b = await login({ sql: h.sql, body: { identifier: email, password: PW }, userAgent: SAFARI_MAC, clientIp: '198.51.100.7' })

    const list = await listSessions({ sql: h.sql, sessionToken: b.session!.token! })
    const other = (list.body as { sessions: { id: string; current: boolean }[] }).sessions.find((s) => !s.current)!

    const res = await revokeSessions({ sql: h.sql, sessionToken: b.session!.token!, body: { sessionId: other.id } })
    expect(res.status).toBe(200)
    expect((res.body as { endedCurrent: boolean }).endedCurrent).toBe(false)
    expect(await validateSession(h.sql, a.session!.token!)).toBeNull()
    expect(await validateSession(h.sql, b.session!.token!)).not.toBeNull()
  })

  test('revoking the CURRENT session says so, so the adapter clears the cookie', async () => {
    const email = await makeUnprivileged()
    const a = await login({ sql: h.sql, body: { identifier: email, password: PW } })
    const list = await listSessions({ sql: h.sql, sessionToken: a.session!.token! })
    const mine = (list.body as { sessions: { id: string; current: boolean }[] }).sessions.find((s) => s.current)!

    const res = await revokeSessions({ sql: h.sql, sessionToken: a.session!.token!, body: { sessionId: mine.id } })
    expect((res.body as { endedCurrent: boolean }).endedCurrent).toBe(true)
    expect(res.session).toEqual({ token: null })
    expect(await validateSession(h.sql, a.session!.token!)).toBeNull()
  })

  test('"sign out everywhere" includes the caller\'s own session', async () => {
    const email = await makeUnprivileged()
    const a = await login({ sql: h.sql, body: { identifier: email, password: PW }, userAgent: CHROME_WIN, clientIp: '203.0.113.10' })
    const b = await login({ sql: h.sql, body: { identifier: email, password: PW }, userAgent: SAFARI_MAC, clientIp: '198.51.100.7' })

    const res = await revokeSessions({ sql: h.sql, sessionToken: b.session!.token!, body: { all: true } })
    expect(res.status).toBe(200)
    expect(res.session).toEqual({ token: null })
    // Someone who suspects a compromise wants ONE button that ends everything.
    expect(await validateSession(h.sql, a.session!.token!)).toBeNull()
    expect(await validateSession(h.sql, b.session!.token!)).toBeNull()
  })

  test("another account's session id is a silent no-op, not an error and not a 404", async () => {
    // Distinguishing "not yours" from "already gone" would confirm the existence
    // of another account's session id.
    const mineEmail = await makeUnprivileged()
    const theirsEmail = await makeUnprivileged()
    const mine = await login({ sql: h.sql, body: { identifier: mineEmail, password: PW } })
    const theirs = await login({ sql: h.sql, body: { identifier: theirsEmail, password: PW } })
    const theirList = await listSessions({ sql: h.sql, sessionToken: theirs.session!.token! })
    const theirSessionId = (theirList.body as { sessions: { id: string }[] }).sessions[0]!.id

    const res = await revokeSessions({
      sql: h.sql,
      sessionToken: mine.session!.token!,
      body: { sessionId: theirSessionId },
    })
    expect(res.status).toBe(200)
    expect((res.body as { endedCurrent: boolean }).endedCurrent).toBe(false)
    // Untouched.
    expect(await validateSession(h.sql, theirs.session!.token!)).not.toBeNull()
  })

  test('an anonymous caller cannot revoke anything', async () => {
    const email = await makeUnprivileged()
    const a = await login({ sql: h.sql, body: { identifier: email, password: PW } })
    const res = await revokeSessions({ sql: h.sql, sessionToken: null, body: { all: true } })
    expect(res.status).toBe(403)
    expect(await validateSession(h.sql, a.session!.token!)).not.toBeNull()
  })
})
