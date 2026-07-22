// -------------------------------------------------------------------------
// Guardian-portal schema tests (Milestone 1 step 7) — the request and fee
// tables from the data model (02-data-model.md): deletion_request,
// export_request, payment_ref, scholarship. Embedded Postgres, synthetic data.
//
// The one database GUARANTEE under test here is the deletion_request refusal
// rule: a `refused` decision must carry a documented `decision_reason`
// (02-data-model.md "A refusal must carry a documented reason"). The rest is
// structural: the tables exist with the ruled columns and enums, and the thin
// read-only fee tables accept the status values the portal reads.
// -------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { Sql } from 'postgres'
import { startHarness, type Harness } from './helpers/pg.js'
import {
  makeAdult,
  makeApplication,
  makeChapter,
  makeEnrollment,
  makeMinor,
  makeTerm,
} from './helpers/fixtures.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

interface Seed {
  chapter: string
  term: string
  director: string
  child: string
  guardian: string
  enrollmentId: string
}

async function seed(sql: Sql): Promise<Seed> {
  const chapter = await makeChapter(sql)
  const term = await makeTerm(sql, chapter)
  const director = await makeAdult(sql)
  const child = await makeMinor(sql)
  const guardian = await makeAdult(sql)
  const application = await makeApplication(sql, chapter, 'parent@example.test')
  const enrollmentId = await makeEnrollment(sql, {
    applicationId: application,
    chapterId: chapter,
    termId: term,
    createdBy: director,
    studentAccountId: child,
    dateOfBirth: null,
  })
  return { chapter, term, director, child, guardian, enrollmentId }
}

describe('payment_ref (thin, read-only status; no amounts as source of truth)', () => {
  test('accepts each status value and carries the stripe ref and tier label', async () => {
    const s = await seed(h.sql)
    for (const status of ['none', 'active', 'past_due', 'waived'] as const) {
      const [row] = await h.sql`
        insert into payment_ref (enrollment_record_id, stripe_customer_ref, status, tier_paid_for)
        values (${s.enrollmentId}, ${'cus_synthetic'}, ${status}, ${'explorer'})
        returning id, status, tier_paid_for
      `
      expect(row!.status).toBe(status)
      expect(row!.tier_paid_for).toBe('explorer')
    }
  })
})

describe('scholarship (percentage only, no monetary amount)', () => {
  test('records an award against the enrollment record', async () => {
    const s = await seed(h.sql)
    const [row] = await h.sql`
      insert into scholarship (enrollment_record_id, awarded_by, percentage, note)
      values (${s.enrollmentId}, ${s.director}, ${50}, ${'need-based'})
      returning id, percentage
    `
    expect(row!.percentage).toBe(50)
  })
})

describe('export_request (the review right, filed for staff fulfillment)', () => {
  test('files in requested, then can be marked fulfilled with a timestamp', async () => {
    const s = await seed(h.sql)
    const [row] = await h.sql`
      insert into export_request (subject_account_id, requested_by, status)
      values (${s.child}, ${s.guardian}, 'requested')
      returning id, status, fulfilled_at
    `
    expect(row!.status).toBe('requested')
    expect(row!.fulfilled_at).toBeNull()
  })
})

describe('deletion_request', () => {
  test('files in requested with a scope, no decision yet', async () => {
    const s = await seed(h.sql)
    for (const scope of ['full', 'redaction'] as const) {
      const [row] = await h.sql`
        insert into deletion_request (subject_account_id, requested_by, scope_requested, status)
        values (${s.child}, ${s.guardian}, ${scope}, 'requested')
        returning id, scope_requested, status, decision_reason, decided_at
      `
      expect(row!.scope_requested).toBe(scope)
      expect(row!.status).toBe('requested')
      expect(row!.decision_reason).toBeNull()
      expect(row!.decided_at).toBeNull()
    }
  })

  test('a refusal WITHOUT a documented reason is rejected (the refusal-requires-reason guarantee)', async () => {
    const s = await seed(h.sql)
    await expect(
      h.sql`
        insert into deletion_request (subject_account_id, requested_by, scope_requested, status, decision_reason)
        values (${s.child}, ${s.guardian}, 'full', 'refused', ${null})
      `,
    ).rejects.toThrow(/deletion_request_refusal_reason|violates check|check constraint/i)
  })

  test('a refusal WITH a documented reason is accepted', async () => {
    const s = await seed(h.sql)
    const [row] = await h.sql`
      insert into deletion_request (
        subject_account_id, requested_by, scope_requested, status, reviewed_by, decision_reason, decided_at
      ) values (
        ${s.child}, ${s.guardian}, 'full', 'refused', ${s.director}, ${'active safeguarding hold'}, now()
      ) returning id, status, decision_reason
    `
    expect(row!.status).toBe('refused')
    expect(row!.decision_reason).toBe('active safeguarding hold')
  })
})
