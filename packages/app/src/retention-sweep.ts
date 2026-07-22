// -------------------------------------------------------------------------
// sweepUnconsentedApplications — the § 312.4(c)(1)(vii) stale-application
// contact-deletion job (compliance-coppa.md Part 2 Stage 1 item 7, Part 3 item
// 5). Direct notice at application tells the family that if consent is not given
// within a reasonable time (30 days, config), CurioLab deletes the contact
// information collected to seek it. This is that real deletion job — "not
// boilerplate".
//
// For each STUDENT application (the COPPA funnel; university-role applications
// are adults, out of scope) that is (a) older than the consent-seeking window
// and (b) has NOT produced an enrollment with a data_collection consent on file,
// the contact PII (applicant_name, applicant_contact_email, guardian_name,
// guardian_email) is redacted to the tombstone. The row survives as a minimal
// non-PII record — its id, kind, status, chapter, and dates are retained — and a
// `retention.contact_deleted` audit_entry is written BY REFERENCE (no PII in
// `detail`, per compliance 1.5's audit rule).
//
// A pure job body: it takes the sql handle and an injectable clock, does its
// work in one transaction, and returns the ids it swept. pg-boss scheduling is
// wired elsewhere; this is only the function. Idempotent — an already-tombstoned
// application is not re-swept, so re-running writes no duplicate audit rows.
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import { writeAudit } from '@curiolab/runtime'
import { defaultRetentionConfig, type RetentionConfig } from './retention.js'

export interface SweepUnconsentedApplicationsDeps {
  sql: Sql
  /** Optional overrides for the retention config (the window, the tombstone). */
  config?: RetentionConfig
}

export interface SweepUnconsentedApplicationsResult {
  /** The applications whose contact PII was redacted on this run. */
  sweptApplicationIds: string[]
}

/**
 * Run the § 312.4(c)(1)(vii) sweep as of `now` (default: wall clock). Redacts
 * the contact information of every overdue, unconsented student application and
 * audits each deletion by reference. Returns the ids swept on this run.
 */
export async function sweepUnconsentedApplications(
  deps: SweepUnconsentedApplicationsDeps,
  now: Date = new Date(),
): Promise<SweepUnconsentedApplicationsResult> {
  const config = deps.config ?? defaultRetentionConfig
  const windowMs = config.consentSeekingWindowMs
  const tombstone = config.contactTombstone
  const cutoff = new Date(now.getTime() - windowMs)

  return await deps.sql.begin(async (tx) => {
    // Redact contact PII on every overdue, unconsented student application. The
    // NOT EXISTS covers both "no linked enrollment_record" and "enrolled but no
    // data_collection consent for it". The tombstone guard makes this idempotent.
    const swept = await tx`
      update application set
        applicant_name = ${tombstone},
        applicant_contact_email = ${tombstone},
        guardian_name = case when guardian_name is not null then ${tombstone} else null end,
        guardian_email = case when guardian_email is not null then ${tombstone} else null end
      where kind = 'student'
        and created_at < ${cutoff}
        and applicant_name is distinct from ${tombstone}
        and not exists (
          select 1
          from enrollment_record er
          join consent c on c.enrollment_record_id = er.id
          where er.application_id = application.id
            and c.type = 'data_collection'
            and c.action = 'grant'
        )
      returning id, chapter_id, status
    `

    for (const row of swept) {
      // detail carries REFERENCES only — the reason, the citation, the window,
      // the field NAMES redacted, and the retained status — never a PII VALUE.
      await writeAudit(tx, {
        action: 'retention.contact_deleted',
        subjectType: 'application',
        subjectId: row.id as string,
        chapterId: row.chapter_id as string,
        detail: {
          reason: 'consent_not_obtained_within_window',
          citation: '16 CFR 312.4(c)(1)(vii)',
          consentSeekingWindowMs: windowMs,
          redactedFields: [
            'applicant_name',
            'applicant_contact_email',
            'guardian_name',
            'guardian_email',
          ],
          retainedStatus: row.status as string,
        },
      })
    }

    return { sweptApplicationIds: swept.map((r) => r.id as string) }
  })
}
