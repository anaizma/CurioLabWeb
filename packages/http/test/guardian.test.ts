// -------------------------------------------------------------------------
// Guardian portal controllers (05-api-surface.md "Guardian portal"). Embedded
// Postgres, synthetic data only.
//
// Task acceptance: a verified guardian views their OWN child (200, and a
// minor_record.read audit row from the logsRead obligation); a DIFFERENT
// guardian is denied with an opaque 403 (no DenyReason leaked). Plus success
// wiring for fees, consent grant/revoke, export/deletion requests, and digest.
// -------------------------------------------------------------------------

import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { startHarness, type Harness } from './helpers/pg.js'
import { onboardStudent, seedVerifiedGuardian } from './helpers/seed.js'
import {
  viewChildRecord,
  viewChildFees,
  grantChildConsent,
  revokeChildConsent,
  requestChildExport,
  requestChildDeletion,
  viewDigest,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

async function minorReads(guardian: string) {
  return h.sql`
    select 1 from audit_entry where action = 'minor_record.read' and actor_account_id = ${guardian}
  `
}

describe('viewChildRecord', () => {
  test('a verified guardian reads their own child (200) and it logs one minor_record.read', async () => {
    const s = await onboardStudent(h.sql, { activate: true })
    const { guardian, guardianToken } = await seedVerifiedGuardian(h.sql, s)

    const res = await viewChildRecord({
      sql: h.sql,
      sessionToken: guardianToken,
      params: { id: s.accountId },
    })
    expect(res.status).toBe(200)
    expect(res.body.childId).toBe(s.accountId)
    expect(res.body.memberships.some((m) => m.role === 'student')).toBe(true)

    const logged = await minorReads(guardian)
    expect(logged).toHaveLength(1)
  })

  test('a DIFFERENT guardian is denied with an opaque 403', async () => {
    const mine = await onboardStudent(h.sql, { activate: true })
    const other = await onboardStudent(h.sql, { activate: true })
    // A guardian verified over `other`, asking for `mine`'s child.
    const otherG = await seedVerifiedGuardian(h.sql, other)

    const res = await viewChildRecord({
      sql: h.sql,
      sessionToken: otherG.guardianToken,
      params: { id: mine.accountId },
    })
    expect(res.status).toBe(403)
    expect(JSON.stringify(res.body)).not.toMatch(/out_of_scope|reason/)
  })

  test('no session is an opaque 403', async () => {
    const s = await onboardStudent(h.sql, { activate: true })
    const res = await viewChildRecord({ sql: h.sql, params: { id: s.accountId } })
    expect(res.status).toBe(403)
  })
})

describe('viewChildFees', () => {
  test('a verified guardian reads fee status (200)', async () => {
    const s = await onboardStudent(h.sql, { activate: true })
    const { guardianToken } = await seedVerifiedGuardian(h.sql, s)
    await h.sql`
      insert into payment_ref (enrollment_record_id, stripe_customer_ref, status, tier_paid_for)
      values (${s.enrollmentRecordId}, 'cus_synthetic', 'active', 'explorer')
    `
    const res = await viewChildFees({ sql: h.sql, sessionToken: guardianToken, params: { id: s.accountId } })
    expect(res.status).toBe(200)
    expect(res.body.paymentStatus).toBe('active')
    // Never an amount.
    expect(JSON.stringify(res.body)).not.toMatch(/amount|\$/i)
  })
})

describe('grantChildConsent / revokeChildConsent', () => {
  test('a guardian grants then revokes a digital consent', async () => {
    const s = await onboardStudent(h.sql, { activate: true })
    const { guardianToken } = await seedVerifiedGuardian(h.sql, s)

    const granted = await grantChildConsent({
      sql: h.sql,
      sessionToken: guardianToken,
      params: { id: s.accountId },
      body: { type: 'platform_participation' },
    })
    expect(granted.status).toBe(201)
    expect(granted.body.action).toBe('grant')
    const [cur] = await h.sql`
      select active from consent_current where student_account_id = ${s.accountId} and type = 'platform_participation'
    `
    expect(cur!.active).toBe(true)

    const revoked = await revokeChildConsent({
      sql: h.sql,
      sessionToken: guardianToken,
      params: { id: s.accountId, type: 'platform_participation' },
    })
    expect(revoked.status).toBe(200)
    expect(revoked.body.action).toBe('revoke')
    const [after] = await h.sql`
      select active from consent_current where student_account_id = ${s.accountId} and type = 'platform_participation'
    `
    expect(after!.active).toBe(false)
  })

  test('granting a form-sourced (non-digital) type is a 400', async () => {
    const s = await onboardStudent(h.sql, { activate: true })
    const { guardianToken } = await seedVerifiedGuardian(h.sql, s)
    const res = await grantChildConsent({
      sql: h.sql,
      sessionToken: guardianToken,
      params: { id: s.accountId },
      body: { type: 'enrollment' },
    })
    expect(res.status).toBe(400)
  })
})

describe('requestChildExport / requestChildDeletion', () => {
  test('a guardian files an export request (201)', async () => {
    const s = await onboardStudent(h.sql, { activate: true })
    const { guardianToken } = await seedVerifiedGuardian(h.sql, s)
    const res = await requestChildExport({ sql: h.sql, sessionToken: guardianToken, params: { id: s.accountId } })
    expect(res.status).toBe(201)
    expect(res.body.status).toBe('requested')
  })

  test('a guardian files a deletion request with a scope (201)', async () => {
    const s = await onboardStudent(h.sql, { activate: true })
    const { guardianToken } = await seedVerifiedGuardian(h.sql, s)
    const res = await requestChildDeletion({
      sql: h.sql,
      sessionToken: guardianToken,
      params: { id: s.accountId },
      body: { scope: 'full' },
    })
    expect(res.status).toBe(201)
    expect(res.body.scopeRequested).toBe('full')
  })
})

describe('viewDigest', () => {
  test('a guardian with a verified minor child gets a digest (200)', async () => {
    const s = await onboardStudent(h.sql, { activate: true })
    const { guardianToken } = await seedVerifiedGuardian(h.sql, s)
    const res = await viewDigest({ sql: h.sql, sessionToken: guardianToken })
    expect(res.status).toBe(200)
    expect(res.body.chapterId).toBe(s.chapter)
  })
})
