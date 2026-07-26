// -------------------------------------------------------------------------
// The bootstrapped platform admin's forced-password-change login flow
// (migration 0040), end to end through the HTTP controllers. Isolated
// harness (a fresh, empty embedded Postgres): bootstrapPlatformAdmin's
// non-empty-database guard means this can only run first, against a
// database with no account rows yet — sharing totp-auth.test.ts's DB would
// trip that guard the moment any earlier test in that file creates an
// account.
//
//   POST /api/auth/login                      -> passwordChangeRequired (no
//                                                 totpRequired, no session)
//   POST /api/auth/password/change-required    -> passwordChanged (no session)
//   POST /api/auth/login (new password)        -> totpRequired
//   POST /api/auth/totp                        -> session
// -------------------------------------------------------------------------

import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { totp } from '@curiolab/runtime'
import { bootstrapPlatformAdmin } from '@curiolab/app'
import { startHarness, type Harness } from './helpers/pg.js'
import { login, submitTotp, completeRequiredPasswordChange } from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

const SEED_PW = 'a-long-operator-set-passphrase'

describe('the bootstrapped platform admin: forced password change gates login', () => {
  test('login -> passwordChangeRequired (no totpRequired yet, no session)', async () => {
    const now = new Date('2026-07-24T12:00:00Z')
    const boot = await bootstrapPlatformAdmin(
      h.sql,
      { legalName: 'Ada Founder', email: 'founder@acuriolab.org', password: SEED_PW },
      { now },
    )
    expect(boot.created).toBe(true)

    const later = new Date(now.getTime() + 60_000)
    const step1 = await login({
      sql: h.sql,
      body: { identifier: 'founder@acuriolab.org', password: SEED_PW },
      now: later,
    })
    // must_change_password is checked BEFORE the 2FA branch: the seed password
    // still works (it is a real credential, just a temporary one), but no
    // session — and no totpRequired either — until it is replaced.
    expect(step1.body).toMatchObject({ passwordChangeRequired: true })
    expect(step1.session).toBeUndefined()

    // --- full flow, continued on the SAME admin ---
    const newPassword = 'a-real-standing-passphrase-42'
    const changeToken = (step1.body as { pendingToken: string }).pendingToken

    const changed = await completeRequiredPasswordChange({
      sql: h.sql,
      body: { pendingToken: changeToken, newPassword },
      now: later,
    })
    expect(changed.status).toBe(200)
    expect(changed.body).toEqual({ passwordChanged: true })
    expect(changed.session).toBeUndefined()

    // The old seed password no longer works.
    const oldStillWorks = await login({
      sql: h.sql,
      body: { identifier: 'founder@acuriolab.org', password: SEED_PW },
      now: later,
    })
    expect(oldStillWorks.status).toBe(401)

    // The SAME change-required token cannot be replayed.
    const replay = await completeRequiredPasswordChange({
      sql: h.sql,
      body: { pendingToken: changeToken, newPassword: 'SomethingElse!99' },
      now: later,
    })
    expect(replay.status).toBe(401)

    // Logging in again with the NEW password: must_change_password is now
    // false, so this proceeds straight to the normal 2FA-required path
    // (TOTP was already activated at bootstrap).
    const step2 = await login({
      sql: h.sql,
      body: { identifier: 'founder@acuriolab.org', password: newPassword },
      now: later,
    })
    expect(step2.body).toMatchObject({ totpRequired: true })
    const totpPendingToken = (step2.body as { pendingToken: string }).pendingToken

    const submit = await submitTotp({
      sql: h.sql,
      body: { pendingToken: totpPendingToken, code: totp(boot.secret!, later.getTime()) },
      now: later,
    })
    expect(submit.status).toBe(200)
    expect(submit.body.accountId).toBe(boot.adminAccountId)
    expect(submit.session?.token).toBeTruthy()
  })

  test('an unknown/forged change-required token is an opaque 401', async () => {
    const res = await completeRequiredPasswordChange({
      sql: h.sql,
      body: { pendingToken: 'forged-token-xyz', newPassword: 'DoesNotMatter!99' },
    })
    expect(res.status).toBe(401)
    expect(res.session).toBeUndefined()
  })

  test('a missing field is a 400', async () => {
    const res = await completeRequiredPasswordChange({ sql: h.sql, body: { pendingToken: 'only-token' } })
    expect(res.status).toBe(400)
  })
})
