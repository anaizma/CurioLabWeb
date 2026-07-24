// -------------------------------------------------------------------------
// §2 — the guarded first-platform-admin bootstrap. Embedded Postgres.
//
// The ONE legitimate account with no inviter. Idempotent: on an empty DB it
// creates exactly one platform_admin (argon2id credential + activated TOTP,
// secret emitted once); a second run refuses and creates nothing.
// -------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { verifyPassword } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { bootstrapPlatformAdmin } from '../src/bootstrap-admin.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

const INPUT = {
  legalName: 'Ada Founder',
  email: 'founder@acuriolab.org',
  password: 'a-long-operator-set-passphrase',
}

describe('bootstrapPlatformAdmin on an empty DB', () => {
  test('creates exactly one platform_admin with an argon2id credential and active TOTP', async () => {
    const res = await bootstrapPlatformAdmin(h.sql, INPUT)
    expect(res.created).toBe(true)
    expect(res.adminAccountId).toBeTruthy()
    expect(res.secret).toMatch(/^[A-Z2-7]+$/)
    expect(res.otpauthUri).toContain('otpauth://totp/')
    expect(res.backupCodes).toHaveLength(10)

    const [acct] = await h.sql`
      select password_hash, totp_secret, totp_activated_at, status, maturation_state
      from account where id = ${res.adminAccountId!}
    `
    expect(await verifyPassword(acct!.password_hash as string, INPUT.password)).toBe(true)
    expect(acct!.totp_secret).toBeTruthy()
    expect(acct!.totp_activated_at).not.toBeNull()
    expect(acct!.status).toBe('active')

    const mems = await h.sql`
      select role, status from membership where account_id = ${res.adminAccountId!}
    `
    expect(mems).toHaveLength(1)
    expect(mems[0]!.role).toBe('platform_admin')
    expect(mems[0]!.status).toBe('active')

    const admins = await h.sql`select count(*)::int as n from membership where role = 'platform_admin'`
    expect((admins[0]!.n as number)).toBe(1)
  })
})

describe('a second invocation is a guarded no-op', () => {
  // NOTE: this file shares ONE database across its tests; the first describe
  // already created the sole platform_admin, so this exercises the guard path.
  test('refuses when a platform_admin already exists and creates nothing', async () => {
    const [existing] = await h.sql`select account_id from membership where role = 'platform_admin'`
    const existingAdminId = existing!.account_id as string

    const before = (await h.sql`select count(*)::int as n from account`)[0]!.n as number
    const second = await bootstrapPlatformAdmin(h.sql, {
      legalName: 'Someone Else',
      email: 'intruder@example.test',
      password: 'another-passphrase-entirely',
    })
    expect(second.created).toBe(false)
    expect(second.adminAccountId).toBe(existingAdminId)
    // No secret is emitted on the no-op path.
    expect(second.secret).toBeUndefined()

    const after = (await h.sql`select count(*)::int as n from account`)[0]!.n as number
    expect(after).toBe(before)
    const admins = (await h.sql`select count(*)::int as n from membership where role = 'platform_admin'`)[0]!.n as number
    expect(admins).toBe(1)
  })
})
