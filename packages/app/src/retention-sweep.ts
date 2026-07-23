// -------------------------------------------------------------------------
// sweepExpiredLeads — the § 312.4(c)(1)(vii) expired-lead deletion job
// (compliance-coppa.md Part 2 Stage 1 item 7, Part 3 item 5; application-funnel
// Stage-1 design §7.2). Stage 1 collects only a parent email (an
// `application_lead`) to seek consent; the direct notice tells the family that
// if no application results within a reasonable time (30 days, stamped as
// `expires_at`), CurioLab deletes the contact information collected to seek it.
// This is that real deletion job — "not boilerplate".
//
// The design's rule is evaluated at REQUEST TIME against the stored floor: for
// each `application_lead` where `converted_at IS NULL AND expires_at < now`, the
// lead row and its `application_draft` rows are DELETED — the parent email held
// only to seek consent is gone — and a `retention.contact_deleted` audit_entry is
// written BY REFERENCE (no PII in `detail`, per compliance 1.5's audit rule).
//
// This supersedes the old child-PII-redaction path over `application`: the public
// surface no longer collects child PII (only 2C submit creates an `application`),
// so there is nothing to redact there. A converted lead (converted_at set) is
// never swept, however old — its retention is governed by the resulting
// application/enrollment schedule, not this consent-seeking window.
//
// A pure job body: it takes the sql handle and an injectable clock, does its work
// in one transaction, and returns the ids/count it deleted. pg-boss scheduling is
// wired elsewhere; this is only the function. Idempotent — a deleted lead is
// gone, so a re-run finds nothing and writes no duplicate audit rows.
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import { writeAudit } from '@curiolab/runtime'

export interface SweepExpiredLeadsDeps {
  sql: Sql
}

export interface SweepExpiredLeadsResult {
  /** The number of leads deleted on this run. */
  deletedCount: number
  /** The ids of the leads deleted on this run. */
  deletedLeadIds: string[]
}

/**
 * Run the § 312.4(c)(1)(vii) sweep as of `now` (default: wall clock). Deletes
 * every lead where `converted_at IS NULL AND expires_at < now` (and its
 * `application_draft` rows) and audits each deletion by reference. Returns the
 * ids and count deleted on this run.
 */
export async function sweepExpiredLeads(
  deps: SweepExpiredLeadsDeps,
  now: Date = new Date(),
): Promise<SweepExpiredLeadsResult> {
  return await deps.sql.begin(async (tx) => {
    // The expired, unconverted leads. A converted lead (converted_at set) is
    // preserved regardless of expiry (retention governed by the resulting
    // application/enrollment). Evaluated at request time against expires_at.
    const targets = await tx`
      select id, chapter_id
      from application_lead
      where converted_at is null
        and expires_at < ${now}
      for update
    `

    for (const row of targets) {
      const leadId = row.id as string
      // Delete the bound drafts first (FK child), then the lead itself.
      await tx`delete from application_draft where lead_id = ${leadId}`
      await tx`delete from application_lead where id = ${leadId}`

      // detail carries REFERENCES only — the reason and the citation — never a
      // PII VALUE (the parent email).
      await writeAudit(tx, {
        action: 'retention.contact_deleted',
        subjectType: 'application_lead',
        subjectId: leadId,
        chapterId: (row.chapter_id as string | null) ?? null,
        detail: {
          reason: 'consent_not_obtained_within_window',
          citation: '16 CFR 312.4(c)(1)(vii)',
          deleted: ['application_lead', 'application_draft'],
        },
      })
    }

    const deletedLeadIds = targets.map((r) => r.id as string)
    return { deletedCount: deletedLeadIds.length, deletedLeadIds }
  })
}
