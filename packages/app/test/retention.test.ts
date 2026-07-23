// -------------------------------------------------------------------------
// Retention configuration + the § 312.4(c)(1)(vii) expired-lead deletion job
// (compliance-coppa.md 1.5, Part 2 Stage 1 item 7, Part 3 item 5; design §7.2).
// Embedded Postgres, synthetic data only.
//
// Stage 1 collects only a parent email (an `application_lead`), so the job is a
// real DELETE of expired, unconverted leads — and their `application_draft` rows.
// The design's rule is evaluated at request time against the stored floor:
// delete every lead where `converted_at IS NULL AND expires_at < now`. A
// PII-free `retention.contact_deleted` audit is written by reference.
// -------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeChapter } from './helpers/fixtures.js'
import {
  CONSENT_SEEKING_WINDOW_MS,
  RETENTION_SCHEDULE,
  defaultRetentionConfig,
  sweepExpiredLeads,
} from '../src/index.js'

const DAY_MS = 24 * 60 * 60 * 1000

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

// --- config as data --------------------------------------------------------

describe('the retention schedule is data (compliance 1.5)', () => {
  test('the § 312.4(c)(1)(vii) consent-seeking window is 30 days', () => {
    expect(CONSENT_SEEKING_WINDOW_MS).toBe(30 * DAY_MS)
    expect(defaultRetentionConfig.consentSeekingWindowMs).toBe(30 * DAY_MS)
  })

  test('verification skeleton, enrollment paperwork, and audit retain 7 years', () => {
    const sevenYears = 7 * 365 * DAY_MS
    expect(RETENTION_SCHEDULE.verification_skeleton.offsetMs).toBe(sevenYears)
    expect(RETENTION_SCHEDULE.enrollment_paperwork.offsetMs).toBe(sevenYears)
    expect(RETENTION_SCHEDULE.audit_entries.offsetMs).toBe(sevenYears)
    for (const cls of ['verification_skeleton', 'enrollment_paperwork', 'audit_entries'] as const) {
      expect(RETENTION_SCHEDULE[cls].anchor).toBe('collection')
    }
  })

  test('contact/DOB/guardian and community/media age out at active enrollment + 1 year', () => {
    const oneYear = 365 * DAY_MS
    for (const cls of ['contact_details', 'community_content'] as const) {
      expect(RETENTION_SCHEDULE[cls].anchor).toBe('active_enrollment_end')
      expect(RETENTION_SCHEDULE[cls].offsetMs).toBe(oneYear)
    }
  })
})

// --- fixtures --------------------------------------------------------------

/**
 * A lead created at `createdAt` with `expires_at = createdAt + 30d` (the default
 * floor). Overrides let a test set status/conversion/expiry/chapter directly.
 */
async function lead(
  createdAt: Date,
  overrides: Partial<{ status: string; withChapter: boolean; expiresAt: Date; converted: boolean }> = {},
): Promise<{ id: string; chapterId: string | null }> {
  const chapterId = overrides.withChapter === false ? null : await makeChapter(h.sql)
  const expiresAt = overrides.expiresAt ?? new Date(createdAt.getTime() + 30 * DAY_MS)
  const convertedAt = overrides.converted ? new Date(createdAt.getTime() + DAY_MS) : null
  const [row] = await h.sql`
    insert into application_lead
      (email, chapter, chapter_id, source, filler_role, status, created_at, expires_at, converted_at)
    values (
      ${'prospect@example.test'}, ${'a-chapter-code'}, ${chapterId}, 'instagram', 'parent',
      ${overrides.status ?? 'new'}, ${createdAt}, ${expiresAt}, ${convertedAt}
    ) returning id
  `
  return { id: row!.id as string, chapterId }
}

/** A Stage 2 draft bound to a lead (part B populates these; here we seed one). */
async function draftFor(leadId: string): Promise<string> {
  const [row] = await h.sql`
    insert into application_draft (lead_id, parent_token_hash, phase, status)
    values (${leadId}, 'hash', '2a', 'in_progress')
    returning id
  `
  return row!.id as string
}

async function leadExists(id: string): Promise<boolean> {
  const [row] = await h.sql`select count(*)::int as n from application_lead where id = ${id}`
  return (row!.n as number) > 0
}
async function draftExists(id: string): Promise<boolean> {
  const [row] = await h.sql`select count(*)::int as n from application_draft where id = ${id}`
  return (row!.n as number) > 0
}
async function retentionAuditFor(leadId: string) {
  return await h.sql`
    select action, subject_type, subject_id, chapter_id, detail, actor_account_id
    from audit_entry
    where subject_type = 'application_lead' and subject_id = ${leadId}
  `
}

// --- the sweep -------------------------------------------------------------

describe('sweepExpiredLeads (§ 312.4(c)(1)(vii))', () => {
  test('an expired unconverted lead AND its draft are deleted, and the deletion is audited by reference', async () => {
    const now = new Date('2026-07-22T00:00:00Z')
    const stale = await lead(new Date(now.getTime() - 40 * DAY_MS)) // expires_at = now - 10d
    const draftId = await draftFor(stale.id)

    const result = await sweepExpiredLeads({ sql: h.sql }, now)

    expect(result.deletedCount).toBeGreaterThanOrEqual(1)
    expect(result.deletedLeadIds).toContain(stale.id)
    expect(await leadExists(stale.id)).toBe(false)
    expect(await draftExists(draftId)).toBe(false)

    const audit = await retentionAuditFor(stale.id)
    expect(audit).toHaveLength(1)
    expect(audit[0]!.action).toBe('retention.contact_deleted')
    expect(audit[0]!.chapter_id).toBe(stale.chapterId)
    expect(audit[0]!.actor_account_id).toBeNull() // system job, no human actor
  })

  test('a live lead (expires_at in the future) is untouched (no deletion, no audit)', async () => {
    const now = new Date('2026-07-22T00:00:00Z')
    const fresh = await lead(new Date(now.getTime() - 5 * DAY_MS)) // expires_at = now + 25d

    const result = await sweepExpiredLeads({ sql: h.sql }, now)

    expect(result.deletedLeadIds).not.toContain(fresh.id)
    expect(await leadExists(fresh.id)).toBe(true)
    expect(await retentionAuditFor(fresh.id)).toHaveLength(0)
  })

  test('a CONVERTED lead (converted_at set) is never swept, however old', async () => {
    const now = new Date('2026-07-22T00:00:00Z')
    const converted = await lead(new Date(now.getTime() - 400 * DAY_MS), { status: 'converted', converted: true })

    const result = await sweepExpiredLeads({ sql: h.sql }, now)

    expect(result.deletedLeadIds).not.toContain(converted.id)
    expect(await leadExists(converted.id)).toBe(true)
    expect(await retentionAuditFor(converted.id)).toHaveLength(0)
  })

  test('an expired lead mid-Stage-2 (started but not converted) IS swept — an unfinished draft is not a conversion', async () => {
    const now = new Date('2026-07-22T00:00:00Z')
    const started = await lead(new Date(now.getTime() - 40 * DAY_MS), { status: 'stage2_started' })
    const draftId = await draftFor(started.id)

    const result = await sweepExpiredLeads({ sql: h.sql }, now)

    expect(result.deletedLeadIds).toContain(started.id)
    expect(await draftExists(draftId)).toBe(false)
  })

  test('expiry is per-row: a lead whose stored expires_at is already past is swept even if freshly created', async () => {
    const now = new Date('2026-07-22T00:00:00Z')
    // Created moments ago but with a deliberately past expires_at.
    const recent = await lead(new Date(now.getTime() - 60_000), { expiresAt: new Date(now.getTime() - DAY_MS) })

    const result = await sweepExpiredLeads({ sql: h.sql }, now)

    expect(result.deletedLeadIds).toContain(recent.id)
    expect(await leadExists(recent.id)).toBe(false)
  })

  test('a chapterless lead can be swept (the audit chapter reference is null)', async () => {
    const now = new Date('2026-07-22T00:00:00Z')
    const stale = await lead(new Date(now.getTime() - 40 * DAY_MS), { withChapter: false })

    const result = await sweepExpiredLeads({ sql: h.sql }, now)

    expect(result.deletedLeadIds).toContain(stale.id)
    const [audit] = await retentionAuditFor(stale.id)
    expect(audit!.chapter_id).toBeNull()
  })

  test('the audit detail holds references, never the parent email PII', async () => {
    const now = new Date('2026-07-22T00:00:00Z')
    const stale = await lead(new Date(now.getTime() - 40 * DAY_MS))

    await sweepExpiredLeads({ sql: h.sql }, now)

    const [audit] = await retentionAuditFor(stale.id)
    const detailStr = JSON.stringify(audit!.detail)
    expect(detailStr).not.toMatch(/prospect@example\.test/)
    expect(audit!.detail).toMatchObject({ citation: '16 CFR 312.4(c)(1)(vii)' })
  })

  test('the sweep is idempotent: a second run deletes nothing more and does not double-audit', async () => {
    const now = new Date('2026-07-22T00:00:00Z')
    const stale = await lead(new Date(now.getTime() - 40 * DAY_MS))

    const first = await sweepExpiredLeads({ sql: h.sql }, now)
    expect(first.deletedLeadIds).toContain(stale.id)

    const second = await sweepExpiredLeads({ sql: h.sql }, now)
    expect(second.deletedLeadIds).not.toContain(stale.id)
    expect(await retentionAuditFor(stale.id)).toHaveLength(1)
  })
})
