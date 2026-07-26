// -------------------------------------------------------------------------
// bootstrapPlatformAdmin's second guard: hard-fail on a non-empty, admin-less
// database. Separate embedded-Postgres instance from bootstrap-admin.test.ts
// (which shares one DB across its "empty DB" and "second invocation" cases)
// because this scenario needs a DB that already has an account but no
// platform_admin — a state the other file's ordering never produces.
//
// A non-empty, admin-less database is NOT the expected precondition for this
// seed (unlike "a platform_admin already exists", which is the documented,
// safe-to-re-run case) — it most likely means the wrong DATABASE_URL was
// supplied, so this throws rather than returning a graceful no-op.
// -------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult } from './helpers/fixtures.js'
import { bootstrapPlatformAdmin, BootstrapDatabaseNotEmptyError } from '../src/bootstrap-admin.js'

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

describe('bootstrapPlatformAdmin on a non-empty, admin-less database', () => {
  test('throws BootstrapDatabaseNotEmptyError and creates nothing', async () => {
    // An ordinary account, no platform_admin membership — e.g. a database
    // pointed at by mistake, or one already carrying synthetic test data.
    await makeAdult(h.sql)

    const before = (await h.sql`select count(*)::int as n from account`)[0]!.n as number
    await expect(bootstrapPlatformAdmin(h.sql, INPUT)).rejects.toBeInstanceOf(
      BootstrapDatabaseNotEmptyError,
    )
    const after = (await h.sql`select count(*)::int as n from account`)[0]!.n as number
    expect(after).toBe(before)

    const admins = (await h.sql`select count(*)::int as n from membership where role = 'platform_admin'`)[0]!
      .n as number
    expect(admins).toBe(0)
  })
})
