# Open questions register

Each item names its owner and what it blocks. Legal items gate Milestone 1 going live with real data (see [08-build-phasing.md](08-build-phasing.md)).

## Awaiting legal review

The founder is not a lawyer and this needs a nonprofit attorney with COPPA competence. Finding and briefing that person is itself weeks, which is part of why fall 2026 runs on paper.

| # | question | owner | blocks |
|---|---|---|---|
| L1 | **Deletion versus seven-year retention.** COPPA gives a parent the right to delete a child's personal information; the retention commitment exists so verification URLs work. These cannot both be absolute. The design implements either answer (tiered full-erase versus redaction preserving an anonymized verification skeleton), but which is lawful, and whether a refusal to fully erase is defensible, is a legal question. This is the top item. | attorney, then founder | deletion fulfillment tooling (M4), and the wording of the retention promise |
| L2 | **Age-18 authority transfer.** Whether guardian read access may lawfully persist past 18 even briefly (the design keeps it through `maturation_pending` and to a 90-day backstop). | attorney | the coming-of-age flow copy and the backstop period |
| L3 | **Safeguarding consent suspension.** Whether a staff member may suspend a minor's `public_profile` and `photo_media` on a safeguarding concern pending a new guardian, which is a staff write to consent, the one sanctioned exception to guardian-or-self. | attorney | the safeguarding path going live |
| L4 | **A minor in a paid, company-like staff role.** An Innovator who becomes a Junior Mentor may be 17, holding a paid role while still a minor with guardian consents. Labor and COPPA implications. | attorney | activating minor mentors |
| L5 | **Whether the signed form plus manual name-match is sufficient verifiable parental consent.** The mechanism is a recognized COPPA method, but confirm for this exact process, including the `in_person_witnessed` and `sms_form_match` variants. | attorney | the guardianship floor as designed |
| L6 | **COPPA data-review and deletion portal adequacy.** Whether the guardian portal as specified satisfies the parent's review and deletion rights in substance, not just form. | attorney | guardian portal sign-off |

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
