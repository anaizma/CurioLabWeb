# Data retention policy (DRAFT SKELETON)

> **DRAFT. Not legal advice.** This is a scaffold to make the conversation with counsel cheaper than a blank page. § 312.10 of the amended COPPA rule (16 CFR Part 312) requires a written retention policy that states, for each category of personal information, the purpose of collection, the business need for retention, and a timeframe for deletion, and requires this policy to be **published in the online privacy notice**. Founder ([PLACEHOLDER: name], the designated data coordinator) and counsel must review, complete the placeholders, and approve before this is published or relied on. Cross-reference: [../compliance-coppa.md](../compliance-coppa.md) 1.5.

## Scope

This policy covers personal information CurioLab collects about students (grades 6 through 12) and their parents or guardians through the CurioLab web platform. It does not cover Luminent, which holds learning records under a separate agreement.

## Principle

CurioLab retains a child's personal information only as long as reasonably necessary for the specific purpose for which it was collected, deletes it when that purpose ends, and never retains it indefinitely. Retention is set per data class, not as a single blanket period.

## Retention schedule

| Data class | What it includes | Retention | Business need |
|---|---|---|---|
| Verification skeleton | Tier reached, project titles, dates, mentor hours | 7 years after the student's last active term | So a former student can verify their record to employers and programs. [PLACEHOLDER: counsel to confirm 7 years is defensible as reasonably necessary under § 312.10 — open item L2.] |
| Enrollment paperwork | Signed enrollment and consent forms | 7 years after the student's last active term | Consent evidence and audit defense. |
| Contact details | Student and guardian contact, DOB, guardian details | Active enrollment plus 1 year | No ongoing purpose after the student leaves the program. |
| Community content | Narrative, feed posts, comments, media | Active enrollment plus 1 year | No verification purpose. |
| Audit entries | Governance log (references only, no PII in detail) | 7 years | Compliance evidence and access accountability. |
| Application leads | A prospective parent's email collected to seek enrollment | 30 days if the application is not submitted | § 312.4(c)(1)(vii): contact information collected to seek consent is deleted if consent is not obtained within a reasonable time. |

## How deletion happens

- **Application leads** that do not convert are deleted automatically 30 days after collection — evaluated at request time against each lead's stored `expires_at` (implemented: the `sweepExpiredLeads` job).
- **Contact details and community content** are deleted or redacted one year after a student's last active term (the retention schedule is expressed in configuration; the sweep for these classes is implemented as the program's data ages).
- **A parent's deletion request** is honored per § 312.6: the parent's deletion right takes priority, and CurioLab may terminate the child's participation as a consequence (implemented: tiered deletion fulfillment). Full erase removes the verification skeleton; redaction preserves an anonymized skeleton with identifiers removed.
- Deletion is recorded in the append-only audit log by reference; the audit entry never contains the deleted personal information.

## Coordinator and review

- Designated data coordinator: [PLACEHOLDER: founder name and contact].
- This policy is reviewed at least annually and whenever the data practices change. Last reviewed: [PLACEHOLDER: date].
- Published at: [PLACEHOLDER: the online privacy notice URL].
