// -------------------------------------------------------------------------
// Retention configuration + the § 312.4(c)(1)(vii) unconverted-lead deletion job
// (compliance-coppa.md 1.5, Part 2 Stage 1 item 7, Part 3 item 5;
// milestone-1-application-funnel.md v2 invariant 7). Embedded Postgres,
// synthetic data only.
//
// Stage 1 now collects only a parent email (an `application_lead`), so the job
// is a real DELETE of stale, unconverted leads — and their `application_draft`
// rows — not a child-PII redaction over `application`. "Unconverted" means the
// lead never reached a submitted application (status is not `converted`). A
// PII-free `retention.contact_deleted` audit is written by reference.
// -------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeChapter } from './helpers/fixtures.js'
import {
  CONSENT_SEEKING_WINDOW_MS,
  RETENTION_SCHEDULE,
  defaultRetentionConfig,
  sweepUnconvertedLeads,
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

/** A lead captured at `createdAt`, with an explicit status and optional chapter. */
async function lead(
  createdAt: Date,
  overrides: Partial<{ status: string; withChapter: boolean }> = {},
): Promise<{ id: string; chapterId: string | null }> {
  const chapterId = overrides.withChapter === false ? null : await makeChapter(h.sql)
  const [row] = await h.sql`
    insert into application_lead (email, chapter_id, referral_source, status, created_at)
    values (
      ${'prospect@example.test'}, ${chapterId}, 'instagram',
      ${overrides.status ?? 'new'}, ${createdAt}
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

describe('sweepUnconvertedLeads (§ 312.4(c)(1)(vii))', () => {
  test('a stale unconverted lead AND its draft are deleted, and the deletion is audited by reference', async () => {
    const now = new Date('2026-07-22T00:00:00Z')
    const stale = await lead(new Date(now.getTime() - 40 * DAY_MS))
    const draftId = await draftFor(stale.id)

    const result = await sweepUnconvertedLeads({ sql: h.sql }, now)

    expect(result.deletedLeadIds).toContain(stale.id)
    expect(await leadExists(stale.id)).toBe(false)
    expect(await draftExists(draftId)).toBe(false)

    const audit = await retentionAuditFor(stale.id)
    expect(audit).toHaveLength(1)
    expect(audit[0]!.action).toBe('retention.contact_deleted')
    expect(audit[0]!.chapter_id).toBe(stale.chapterId)
    expect(audit[0]!.actor_account_id).toBeNull() // system job, no human actor
  })

  test('a fresh lead within the window is untouched (no deletion, no audit)', async () => {
    const now = new Date('2026-07-22T00:00:00Z')
    const fresh = await lead(new Date(now.getTime() - 5 * DAY_MS))

    const result = await sweepUnconvertedLeads({ sql: h.sql }, now)

    expect(result.deletedLeadIds).not.toContain(fresh.id)
    expect(await leadExists(fresh.id)).toBe(true)
    expect(await retentionAuditFor(fresh.id)).toHaveLength(0)
  })

  test('a CONVERTED lead is never swept, however old', async () => {
    const now = new Date('2026-07-22T00:00:00Z')
    const converted = await lead(new Date(now.getTime() - 400 * DAY_MS), { status: 'converted' })

    const result = await sweepUnconvertedLeads({ sql: h.sql }, now)

    expect(result.deletedLeadIds).not.toContain(converted.id)
    expect(await leadExists(converted.id)).toBe(true)
    expect(await retentionAuditFor(converted.id)).toHaveLength(0)
  })

  test('a stale lead mid-Stage-2 (not yet converted) IS swept — an unfinished draft is not a conversion', async () => {
    const now = new Date('2026-07-22T00:00:00Z')
    const started = await lead(new Date(now.getTime() - 40 * DAY_MS), { status: 'stage2_started' })
    const draftId = await draftFor(started.id)

    const result = await sweepUnconvertedLeads({ sql: h.sql }, now)

    expect(result.deletedLeadIds).toContain(started.id)
    expect(await draftExists(draftId)).toBe(false)
  })

  test('the window comes from config: a tighter window sweeps an otherwise-fresh lead', async () => {
    const now = new Date('2026-07-22T00:00:00Z')
    const recent = await lead(new Date(now.getTime() - 5 * DAY_MS))

    const tightConfig = { ...defaultRetentionConfig, consentSeekingWindowMs: DAY_MS }
    const result = await sweepUnconvertedLeads({ sql: h.sql, config: tightConfig }, now)

    expect(result.deletedLeadIds).toContain(recent.id)
    expect(await leadExists(recent.id)).toBe(false)
  })

  test('a chapterless lead can be swept (the audit chapter reference is null)', async () => {
    const now = new Date('2026-07-22T00:00:00Z')
    const stale = await lead(new Date(now.getTime() - 40 * DAY_MS), { withChapter: false })

    const result = await sweepUnconvertedLeads({ sql: h.sql }, now)

    expect(result.deletedLeadIds).toContain(stale.id)
    const [audit] = await retentionAuditFor(stale.id)
    expect(audit!.chapter_id).toBeNull()
  })

  test('the audit detail holds references, never the parent email PII', async () => {
    const now = new Date('2026-07-22T00:00:00Z')
    const stale = await lead(new Date(now.getTime() - 40 * DAY_MS))

    await sweepUnconvertedLeads({ sql: h.sql }, now)

    const [audit] = await retentionAuditFor(stale.id)
    const detailStr = JSON.stringify(audit!.detail)
    expect(detailStr).not.toMatch(/prospect@example\.test/)
    expect(audit!.detail).toMatchObject({ citation: '16 CFR 312.4(c)(1)(vii)' })
  })

  test('the sweep is idempotent: a second run deletes nothing more and does not double-audit', async () => {
    const now = new Date('2026-07-22T00:00:00Z')
    const stale = await lead(new Date(now.getTime() - 40 * DAY_MS))

    const first = await sweepUnconvertedLeads({ sql: h.sql }, now)
    expect(first.deletedLeadIds).toContain(stale.id)

    const second = await sweepUnconvertedLeads({ sql: h.sql }, now)
    expect(second.deletedLeadIds).not.toContain(stale.id)
    expect(await retentionAuditFor(stale.id)).toHaveLength(1)
  })
})
