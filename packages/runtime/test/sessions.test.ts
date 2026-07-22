import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeMinor } from './helpers/fixtures.js'
import { hashToken } from '../src/tokens.js'
import {
  createImpersonationSession,
  createSession,
  revokeAllSessionsForAccount,
  revokeSession,
  validateSession,
} from '../src/sessions.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

describe('session lifecycle', () => {
  test('create returns an opaque token whose hash (not the token) is stored', async () => {
    const acct = await makeAdult(h.sql)
    const now = new Date()
    const s = await createSession(h.sql, {
      accountId: acct,
      expiresAt: new Date(now.getTime() + 60_000),
    })
    expect(s.token).toBeTruthy()
    const [row] = await h.sql`select token_hash from session where id = ${s.id}`
    expect(row!.token_hash).toBe(hashToken(s.token))
    expect(row!.token_hash).not.toBe(s.token)
  })

  test('validate accepts a live token and rejects an unknown one', async () => {
    const acct = await makeAdult(h.sql)
    const now = new Date()
    const s = await createSession(h.sql, {
      accountId: acct,
      expiresAt: new Date(now.getTime() + 60_000),
    })
    const ok = await validateSession(h.sql, s.token, now)
    expect(ok?.id).toBe(s.id)
    expect(ok?.accountId).toBe(acct)
    expect(await validateSession(h.sql, 'not-a-real-token', now)).toBeNull()
  })

  test('rejects an expired session at decision time (must-not #29)', async () => {
    const acct = await makeAdult(h.sql)
    const expiresAt = new Date(Date.now() + 60_000)
    const s = await createSession(h.sql, { accountId: acct, expiresAt })
    // One ms before expiry: valid. At expiry / after: rejected. Decision-time,
    // not sweeper-dependent — the row is still present.
    expect(await validateSession(h.sql, s.token, new Date(expiresAt.getTime() - 1))).not.toBeNull()
    expect(await validateSession(h.sql, s.token, expiresAt)).toBeNull()
    expect(await validateSession(h.sql, s.token, new Date(expiresAt.getTime() + 1))).toBeNull()
  })

  test('rejects a revoked session immediately (revoked_at <= now)', async () => {
    const acct = await makeAdult(h.sql)
    const s = await createSession(h.sql, {
      accountId: acct,
      expiresAt: new Date(Date.now() + 60_000),
    })
    const revokeAt = new Date()
    await revokeSession(h.sql, s.id, revokeAt)
    expect(await validateSession(h.sql, s.token, revokeAt)).toBeNull()
    expect(await validateSession(h.sql, s.token, new Date(revokeAt.getTime() + 1_000))).toBeNull()
  })

  test('revokeAllSessionsForAccount invalidates every live session immediately (must-not #30)', async () => {
    const acct = await makeAdult(h.sql)
    const future = () => new Date(Date.now() + 60_000)
    const a = await createSession(h.sql, { accountId: acct, expiresAt: future() })
    const b = await createSession(h.sql, { accountId: acct, expiresAt: future() })
    const at = new Date()
    await revokeAllSessionsForAccount(h.sql, acct, at)
    expect(await validateSession(h.sql, a.token, at)).toBeNull()
    expect(await validateSession(h.sql, b.token, at)).toBeNull()
  })
})

describe('impersonation sessions', () => {
  test('a full impersonation targeting a minor is rejected by the database floor (must-not #11)', async () => {
    const staff = await makeAdult(h.sql)
    const minor = await makeMinor(h.sql)
    await expect(
      createSession(h.sql, {
        accountId: staff,
        mode: 'full',
        expiresAt: new Date(Date.now() + 30 * 60_000),
        impersonatedAccountId: minor,
        realActorAccountId: staff,
      }),
    ).rejects.toThrow(/read_only/i)
  })

  test('createImpersonationSession of a minor is read_only, 30-minute, and validates', async () => {
    const staff = await makeAdult(h.sql)
    const minor = await makeMinor(h.sql)
    const now = new Date()
    const s = await createImpersonationSession(h.sql, {
      realActorAccountId: staff,
      impersonatedAccountId: minor,
      targetIsMinor: true,
      now,
    })
    expect(s.mode).toBe('read_only')
    // 30-minute window (allow a few seconds of slack for clock/execution).
    const minutes = (s.expiresAt.getTime() - now.getTime()) / 60_000
    expect(minutes).toBeGreaterThan(29)
    expect(minutes).toBeLessThanOrEqual(30.1)
    const v = await validateSession(h.sql, s.token, now)
    expect(v?.mode).toBe('read_only')
    expect(v?.impersonatedAccountId).toBe(minor)
    expect(v?.realActorAccountId).toBe(staff)
  })

  test('createImpersonationSession of an adult may be full', async () => {
    const staff = await makeAdult(h.sql)
    const adult = await makeAdult(h.sql)
    const s = await createImpersonationSession(h.sql, {
      realActorAccountId: staff,
      impersonatedAccountId: adult,
      targetIsMinor: false,
      mode: 'full',
    })
    expect(s.mode).toBe('full')
  })
})
