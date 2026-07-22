// -------------------------------------------------------------------------
// Retention configuration — VALUES, not code (compliance-coppa.md 1.5 and Part 3
// "Configuration, not code"). § 312.10 (new in the 2025 amendments) requires
// retaining a child's personal information only as long as reasonably necessary
// for the purpose it was collected for, with a written schedule and a deletion
// timeframe. A blanket seven-year rule is NOT lawful; retention is tiered by data
// class. The schedule below is that policy expressed as data, so an unfavorable
// legal answer on § 312.10 becomes a value change here, never a migration.
//
// The § 312.4(c)(1)(vii) consent-seeking window (30 days) lives here too: it is
// the deadline the stale-application contact-deletion job (retention-sweep.ts)
// reads to decide what is overdue.
// -------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000
/** A retention "year" is 365 days. A value, not a legal constant. */
const YEAR_MS = 365 * DAY_MS

/** Seven-year classes (verification skeleton, paperwork, audit). */
export const SEVEN_YEARS_MS = 7 * YEAR_MS
/** The "plus one year" past active enrollment for contact and community data. */
export const ONE_YEAR_MS = YEAR_MS
/**
 * The § 312.4(c)(1)(vii) consent-seeking window: if verifiable parental consent
 * is not obtained within this long of collecting the contact information used to
 * seek it, that contact information is deleted (compliance-coppa.md Part 3 item
 * 5, "proposed: 30 days from contact collection").
 */
export const CONSENT_SEEKING_WINDOW_MS = 30 * DAY_MS

/**
 * The tombstone written over a redacted PII field. A single, obviously-synthetic
 * value so a swept application is visibly de-identified while the row (id, kind,
 * status, chapter, dates) survives as a minimal non-PII record.
 */
export const CONTACT_TOMBSTONE = '[redacted]'

/**
 * Where a class's clock starts. `collection` counts from when the data was
 * collected (the seven-year classes); `active_enrollment_end` counts from the
 * end of active enrollment (the "active enrollment + 1 year" classes).
 */
export type RetentionAnchor = 'collection' | 'active_enrollment_end'

export interface RetentionRule {
  anchor: RetentionAnchor
  /** How long past the anchor the data is retained, in milliseconds. */
  offsetMs: number
}

/** The data classes of compliance-coppa.md 1.5. */
export type RetentionDataClass =
  | 'verification_skeleton'
  | 'enrollment_paperwork'
  | 'contact_details'
  | 'community_content'
  | 'audit_entries'

/**
 * The retention schedule of compliance-coppa.md 1.5, as data:
 *  - verification skeleton, enrollment paperwork, audit entries -> 7 years from
 *    collection (stated purpose / consent evidence / compliance evidence);
 *  - contact / DOB / guardian details and narrative / community / media ->
 *    active enrollment + 1 year (no ongoing purpose after that).
 */
export const RETENTION_SCHEDULE: Record<RetentionDataClass, RetentionRule> = {
  verification_skeleton: { anchor: 'collection', offsetMs: SEVEN_YEARS_MS },
  enrollment_paperwork: { anchor: 'collection', offsetMs: SEVEN_YEARS_MS },
  audit_entries: { anchor: 'collection', offsetMs: SEVEN_YEARS_MS },
  contact_details: { anchor: 'active_enrollment_end', offsetMs: ONE_YEAR_MS },
  community_content: { anchor: 'active_enrollment_end', offsetMs: ONE_YEAR_MS },
}

export interface RetentionConfig {
  /** The tiered schedule by data class (compliance 1.5). */
  schedule: Record<RetentionDataClass, RetentionRule>
  /** The § 312.4(c)(1)(vii) consent-seeking deletion deadline, in ms. */
  consentSeekingWindowMs: number
  /** The value written over a redacted PII field. */
  contactTombstone: string
}

export const defaultRetentionConfig: RetentionConfig = {
  schedule: RETENTION_SCHEDULE,
  consentSeekingWindowMs: CONSENT_SEEKING_WINDOW_MS,
  contactTombstone: CONTACT_TOMBSTONE,
}
