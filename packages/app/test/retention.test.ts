// -------------------------------------------------------------------------
// Retention configuration + the § 312.4(c)(1)(vii) stale-application
// contact-deletion job (compliance-coppa.md 1.5, Part 2 Stage 1 item 7, Part 3
// item 5). Embedded Postgres, synthetic data only.
//
// The job: an application older than the consent-seeking window that has NOT
// produced an enrollment with data_collection consent on file has its contact
// PII redacted to a tombstone (keeping a minimal non-PII record of the
// application and its status), and a retention audit_entry is written by
// reference (no PII in `detail`). An application that reached enrollment WITH
// consent is never swept, regardless of age.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeChapter, makeAdult, makeMinor } from './helpers/fixtures.js'
import {
  CONSENT_SEEKING_WINDOW_MS,
  RETENTION_SCHEDULE,
  CONTACT_TOMBSTONE,
  defaultRetentionConfig,
  sweepUnconsentedApplications,
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

interface StudentAppFields {
  applicant_name: string
  applicant_contact_email: string
  guardian_name: string | null
  guardian_email: string | null
  status: string
  kind: string
}

/** A student application with an explicit created_at (submission instant). */
async function studentApplication(
  createdAt: Date,
  overrides: Partial<{ status: string; guardianEmail: string; guardianName: string }> = {},
): Promise<{ id: string; chapterId: string }> {
  const chapterId = await makeChapter(h.sql)
  const [row] = await h.sql`
    insert into application (
      kind, chapter_id, status, applicant_name, applicant_contact_email,
      guardian_name, guardian_email, created_at
    ) values (
      'student', ${chapterId}, ${overrides.status ?? 'submitted'}, 'Minor Testchild',
      'parent@example.test', ${overrides.guardianName ?? 'Parent Testperson'},
      ${overrides.guardianEmail ?? 'parent@example.test'}, ${createdAt}
    ) returning id
  `
  return { id: row!.id as string, chapterId }
}

async function readApp(id: string): Promise<StudentAppFields> {
  const [row] = await h.sql`
    select applicant_name, applicant_contact_email, guardian_name, guardian_email, status, kind
    from application where id = ${id}
  `
  return row as unknown as StudentAppFields
}

async function retentionAuditFor(applicationId: string) {
  return await h.sql`
    select action, subject_type, subject_id, chapter_id, detail, actor_account_id
    from audit_entry
    where subject_type = 'application' and subject_id = ${applicationId}
  `
}

/**
 * A student application that REACHED enrollment WITH a data_collection consent
 * on file — the case that must never be swept regardless of age. Builds the
 * term, enrollment record, and a signed-form data_collection consent, honouring
 * the consent link + temporal DB rules.
 */
async function enrolledConsentedApplication(createdAt: Date): Promise<{ id: string }> {
  const app = await studentApplication(createdAt)
  const [term] = await h.sql`
    insert into term (chapter_id, name, starts_on, ends_on)
    values (${app.chapterId}, 'Fall Term 2099', '2099-09-01', '2099-12-15') returning id
  `
  const director = await makeAdult(h.sql)
  const student = await makeMinor(h.sql)
  const signedFormRef = randomUUID()
  const [enr] = await h.sql`
    insert into enrollment_record (
      application_id, student_account_id, chapter_id, term_id,
      signed_form_ref, guardian_name_on_form, created_by
    ) values (
      ${app.id}, ${student}, ${app.chapterId}, ${term!.id}, ${signedFormRef},
      'Parent Testperson', ${director}
    ) returning id
  `
  // A data_collection consent anchored to the enrollment record, effective after
  // the application submission (the temporal floor) and not in the future.
  const effectiveAt = new Date(createdAt.getTime() + DAY_MS)
  await h.sql`
    insert into consent (
      student_account_id, type, action, source, source_ref,
      enrollment_record_id, granted_by, effective_at, reason
    ) values (
      ${student}, 'data_collection', 'grant', 'signed_form', ${signedFormRef},
      ${enr!.id}, ${null}, ${effectiveAt}, 'standard'
    )
  `
  return { id: app.id }
}

// --- the sweep -------------------------------------------------------------

describe('sweepUnconsentedApplications (§ 312.4(c)(1)(vii))', () => {
  test('a stale unconsented application is redacted to a tombstone and audited', async () => {
    const now = new Date('2026-07-22T00:00:00Z')
    const stale = await studentApplication(new Date(now.getTime() - 40 * DAY_MS))

    const result = await sweepUnconsentedApplications({ sql: h.sql }, now)

    expect(result.sweptApplicationIds).toContain(stale.id)

    const app = await readApp(stale.id)
    expect(app.applicant_name).toBe(CONTACT_TOMBSTONE)
    expect(app.applicant_contact_email).toBe(CONTACT_TOMBSTONE)
    expect(app.guardian_name).toBe(CONTACT_TOMBSTONE)
    expect(app.guardian_email).toBe(CONTACT_TOMBSTONE)
    // Minimal non-PII record of the application and its status is kept.
    expect(app.status).toBe('submitted')
    expect(app.kind).toBe('student')

    const audit = await retentionAuditFor(stale.id)
    expect(audit).toHaveLength(1)
    expect(audit[0]!.action).toBe('retention.contact_deleted')
    expect(audit[0]!.chapter_id).toBe(stale.chapterId)
    expect(audit[0]!.actor_account_id).toBeNull() // system job, no human actor
  })

  test('a fresh application within the window is untouched (no redaction, no audit)', async () => {
    const now = new Date('2026-07-22T00:00:00Z')
    const fresh = await studentApplication(new Date(now.getTime() - 5 * DAY_MS))

    const result = await sweepUnconsentedApplications({ sql: h.sql }, now)

    expect(result.sweptApplicationIds).not.toContain(fresh.id)
    const app = await readApp(fresh.id)
    expect(app.applicant_name).toBe('Minor Testchild')
    expect(app.applicant_contact_email).toBe('parent@example.test')
    expect(await retentionAuditFor(fresh.id)).toHaveLength(0)
  })

  test('an application that reached enrollment WITH consent is never swept, however old', async () => {
    const now = new Date('2026-07-22T00:00:00Z')
    // Far older than the window, but consented -> must be preserved.
    const consented = await enrolledConsentedApplication(new Date(now.getTime() - 400 * DAY_MS))

    const result = await sweepUnconsentedApplications({ sql: h.sql }, now)

    expect(result.sweptApplicationIds).not.toContain(consented.id)
    const app = await readApp(consented.id)
    expect(app.applicant_name).toBe('Minor Testchild')
    expect(app.guardian_email).toBe('parent@example.test')
    expect(await retentionAuditFor(consented.id)).toHaveLength(0)
  })

  test('an enrolled application with NO consent on file IS swept (enrollment alone is not enough)', async () => {
    const now = new Date('2026-07-22T00:00:00Z')
    const app = await studentApplication(new Date(now.getTime() - 40 * DAY_MS))
    const [term] = await h.sql`
      insert into term (chapter_id, name, starts_on, ends_on)
      values (${app.chapterId}, 'Fall Term 2099', '2099-09-01', '2099-12-15') returning id
    `
    const director = await makeAdult(h.sql)
    await h.sql`
      insert into enrollment_record (
        application_id, chapter_id, term_id, signed_form_ref, guardian_name_on_form, created_by
      ) values (
        ${app.id}, ${app.chapterId}, ${term!.id}, ${randomUUID()}, 'Parent Testperson', ${director}
      )
    `

    const result = await sweepUnconsentedApplications({ sql: h.sql }, now)

    expect(result.sweptApplicationIds).toContain(app.id)
    expect((await readApp(app.id)).applicant_name).toBe(CONTACT_TOMBSTONE)
  })

  test('the window comes from config: a tighter window sweeps an otherwise-fresh application', async () => {
    const now = new Date('2026-07-22T00:00:00Z')
    const recent = await studentApplication(new Date(now.getTime() - 5 * DAY_MS))

    // Default window (30d) leaves it alone; a 1-day window sweeps it.
    const tightConfig = { ...defaultRetentionConfig, consentSeekingWindowMs: DAY_MS }
    const result = await sweepUnconsentedApplications({ sql: h.sql, config: tightConfig }, now)

    expect(result.sweptApplicationIds).toContain(recent.id)
    expect((await readApp(recent.id)).applicant_name).toBe(CONTACT_TOMBSTONE)
  })

  test('the audit detail holds references, never the redacted PII', async () => {
    const now = new Date('2026-07-22T00:00:00Z')
    const stale = await studentApplication(new Date(now.getTime() - 40 * DAY_MS))

    await sweepUnconsentedApplications({ sql: h.sql }, now)

    const [audit] = await retentionAuditFor(stale.id)
    const detailStr = JSON.stringify(audit!.detail)
    // No PII values leak into the audit trail.
    expect(detailStr).not.toMatch(/Minor Testchild/)
    expect(detailStr).not.toMatch(/Parent Testperson/)
    expect(detailStr).not.toMatch(/parent@example\.test/)
    expect(detailStr).not.toMatch(/\[redacted\]/)
    // It DOES carry references: the reason and the citation.
    expect(audit!.detail).toMatchObject({ citation: '16 CFR 312.4(c)(1)(vii)' })
  })

  test('the sweep is idempotent: a second run neither re-redacts nor double-audits', async () => {
    const now = new Date('2026-07-22T00:00:00Z')
    const stale = await studentApplication(new Date(now.getTime() - 40 * DAY_MS))

    const first = await sweepUnconsentedApplications({ sql: h.sql }, now)
    expect(first.sweptApplicationIds).toContain(stale.id)

    const second = await sweepUnconsentedApplications({ sql: h.sql }, now)
    expect(second.sweptApplicationIds).not.toContain(stale.id)
    expect(await retentionAuditFor(stale.id)).toHaveLength(1)
  })
})
