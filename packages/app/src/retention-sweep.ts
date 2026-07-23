// -------------------------------------------------------------------------
// sweepUnconvertedLeads — the § 312.4(c)(1)(vii) unconverted-lead deletion job
// (compliance-coppa.md Part 2 Stage 1 item 7, Part 3 item 5;
// milestone-1-application-funnel.md v2 invariant 7). Stage 1 collects only a
// parent email (an `application_lead`) to seek consent; the direct notice tells
// the family that if no application results within a reasonable time (30 days,
// config), CurioLab deletes the contact information collected to seek it. This
// is that real deletion job — "not boilerplate".
//
// For each `application_lead` that is (a) older than the consent-seeking window
// and (b) NOT `converted` (no submitted application resulted), the lead row and
// its `application_draft` rows are DELETED — the parent email held only to seek
// consent is gone — and a `retention.contact_deleted` audit_entry is written BY
// REFERENCE (no PII in `detail`, per compliance 1.5's audit rule).
//
// This supersedes the old child-PII-redaction path over `application`: the
// public surface no longer collects child PII (only 2C submit, part B, creates
// an `application`), so there is nothing to redact there. A converted lead is
// never swept, however old, because its retention is governed by the resulting
// application/enrollment schedule, not this consent-seeking window.
//
// A pure job body: it takes the sql handle and an injectable clock, does its
// work in one transaction, and returns the ids it deleted. pg-boss scheduling is
// wired elsewhere; this is only the function. Idempotent — a deleted lead is
// gone, so a re-run finds nothing and writes no duplicate audit rows.
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import { writeAudit } from '@curiolab/runtime'
import { defaultRetentionConfig, type RetentionConfig } from './retention.js'

export interface SweepUnconvertedLeadsDeps {
  sql: Sql
  /** Optional overrides for the retention config (the consent-seeking window). */
  config?: RetentionConfig
}

export interface SweepUnconvertedLeadsResult {
  /** The leads deleted on this run. */
  deletedLeadIds: string[]
}

/**
 * Run the § 312.4(c)(1)(vii) sweep as of `now` (default: wall clock). Deletes
 * every overdue, unconverted `application_lead` (and its `application_draft`
 * rows) and audits each deletion by reference. Returns the ids deleted on this
 * run.
 */
export async function sweepUnconvertedLeads(
  deps: SweepUnconvertedLeadsDeps,
  now: Date = new Date(),
): Promise<SweepUnconvertedLeadsResult> {
  const config = deps.config ?? defaultRetentionConfig
  const windowMs = config.consentSeekingWindowMs
  const cutoff = new Date(now.getTime() - windowMs)

  return await deps.sql.begin(async (tx) => {
    // The overdue, unconverted leads. A `converted` lead is preserved regardless
    // of age (its retention is governed by the resulting application/enrollment).
    const targets = await tx`
      select id, chapter_id
      from application_lead
      where created_at < ${cutoff}
        and status <> 'converted'
      for update
    `

    for (const row of targets) {
      const leadId = row.id as string
      // Delete the bound drafts first (FK child), then the lead itself.
      await tx`delete from application_draft where lead_id = ${leadId}`
      await tx`delete from application_lead where id = ${leadId}`

      // detail carries REFERENCES only — the reason, the citation, and the
      // window — never a PII VALUE (the parent email).
      await writeAudit(tx, {
        action: 'retention.contact_deleted',
        subjectType: 'application_lead',
        subjectId: leadId,
        chapterId: (row.chapter_id as string | null) ?? null,
        detail: {
          reason: 'consent_not_obtained_within_window',
          citation: '16 CFR 312.4(c)(1)(vii)',
          consentSeekingWindowMs: windowMs,
          deleted: ['application_lead', 'application_draft'],
        },
      })
    }

    return { deletedLeadIds: targets.map((r) => r.id as string) }
  })
}
