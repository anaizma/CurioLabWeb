# Open questions register

Each item names its owner and what it blocks. Legal items gate Milestone 1 going live with real data (see [08-build-phasing.md](08-build-phasing.md)). They do **not** gate building or testing Milestone 1 against synthetic data — the funnel and its flows are built now and exercised on synthetic fixtures; only real-family data in production waits on the review.

## Awaiting legal review

The founder is not a lawyer and this needs a nonprofit attorney with COPPA competence. The list below is narrowed by the analysis in [compliance-coppa.md](compliance-coppa.md), which resolved several items against the amended rule (16 CFR Part 312, 90 FR 16977). Item L1 is the one that could change posture materially; L2 through L5 are narrow.

| # | question | owner | blocks |
|---|---|---|---|
| L1 | **Does the § 312.2 nonprofit exclusion apply**, given the Luminent licensing relationship and shared founder? Build assuming no. The open complications are curriculum licensing to for-profit businesses and sponsorship framing. | attorney | posture only; build proceeds to full compliance regardless |
| L2 | **Is seven-year retention of the verification skeleton** (tier, project titles, dates, mentor hours) defensible under § 312.10 as reasonably necessary? | attorney | the retention number for that one data class |
| L3 | **Confirm § 312.6(c) termination** is the right response to a parent's deletion demand, and what notice the family is owed. | attorney | deletion fulfillment copy |
| L4 | **Ohio requirements for a seventeen-year-old in a paid staff role** over younger minors. | attorney | activating minor mentors |
| L5 | **Whether guardian read access may persist past 18** during the maturation window. | attorney | the coming-of-age copy and the backstop period |

Retained design flag, not on the narrowed list but worth the attorney's eye if it goes live: the safeguarding consent suspension (a staff write to consent) in [04-state-machines.md](04-state-machines.md).

FERPA is not built for now. It may apply later if CurioLab partners with a school district or receives federal funding. Two places are cheap to keep FERPA-ready and are already built that way: the audit `detail` plus the `minor_record.read` action make an access log a query, and the clean separation of verified academic-ish data from narrative and community content keeps a future directory-versus-protected-record line drawable. Neither costs anything today.

## Still genuinely undecided (design, not legal)

| # | question | owner | notes |
|---|---|---|---|
| D1 | **`project.verify` by minors.** A 17-year-old junior mentor can verify projects that become tier-transition evidence. Left available for now, flagged alongside L4. | founder | may become an age condition on the capability |
| D2 | **The Luminent boundary, as a proposal.** This platform is authoritative for tier, project verification, mentor hours, and timeline at launch. When Luminent becomes a production record system, the sync direction and the authoritative source per field must be settled. Proposed: this platform stays authoritative for verification and pushes to Luminent, but that is a proposal to revisit when Luminent exists. | founder, with Luminent | M4 sync design |
| D3 | **The 90-day maturation backstop period.** Chosen as a reasonable default; may change with L2's answer. | founder | notice timing |
| D4 | **Moderation staffing reality.** The 24-hour safety window assumes someone is reachable. Confirm the on-call arrangement that makes the committed window real, since a number in a database is not a response. | founder | the SLA being credible |

## Resolved here, recorded so they are not reopened

- Grade range is 6 through 12.
- This platform is authoritative for tier and project verification at launch.
- Strictest COPPA path for all minors, no branching at 13.
- Moderation owner is the Chapter Director, with instructors as first responders and escalation to `platform_admin`.
- Billing is external (Stripe); scholarships are native.
- Feed reading requires `platform_participation` for minors.

## Resolved by the COPPA analysis (see [compliance-coppa.md](compliance-coppa.md))

- **Deletion versus retention** is not a standoff. § 312.6 gives the parent's deletion right priority and § 312.6(c) permits terminating participation as the consequence. Deletion ends participation and the verification record; this is stated in the consent form.
- **Retention is tiered by data class**, not a blanket seven years, per § 312.10. Contact details, DOB, and community content age out at active enrollment plus one year; only the verification skeleton and consent evidence keep the longer window.
- **The signed-form consent method is valid** under § 312.5(b)(2)(i), scan or in-person. `email_plus` and `text_plus` are unavailable because CurioLab discloses.
- **Public visibility requires separate consent** (§ 312.5(a)(2)) and cannot gate participation (§ 312.7). Already designed; now enforced as a check.
- **The application funnel supersedes the single-row application model.** The public write creates an `application_lead` (parent email only, no child data). Child facts and the student's own section are collected in Stage 2 and submitted by the parent at 2C. See [plans/milestone-1-application-funnel.md](plans/milestone-1-application-funnel.md).
- **The § 312.4(c)(1)(vii) delete-if-no-consent job is the 30-day `application_lead` expiry.** Unconverted leads (no submitted application) are swept 30 days after collection.

## Documents to write (not code), tracked in [compliance-coppa.md](compliance-coppa.md)

- Written data retention policy (§ 312.10), written information security program (§ 312.8(b), founder as coordinator), online privacy notice (§ 312.4(d)), and third-party written assurances (§ 312.8(c)) from the Postgres host, R2, and Resend.
