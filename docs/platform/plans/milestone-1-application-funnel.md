# Milestone 1 application funnel: lead versus application

This plan records the split the build-phasing doc introduced: the public endpoint collects a parent email and nothing about a child, and a child's data enters only later, staff-side and gated. It supersedes the earlier single-row `application` that collected a child's name at the public endpoint (built in M1 step 1 and reworked here). It is grounded in [../08-build-phasing.md](../08-build-phasing.md) "Buildable now versus live with real data" and [../compliance-coppa.md](../compliance-coppa.md).

## Why the split

The public application endpoint is the one surface a stranger reaches unauthenticated. If it collects a child's name and school, that is a child's personal information collected before any consent, at the least controlled point in the system. Collecting only a parent or guardian email at Stage 1 keeps the public surface outside COPPA's minor-data category (the same category as the public marketing site), which is why Stage 1 can go live during the paper period while Stages 2 and 3 wait behind the legal review.

## The three stages

### Stage 1: lead capture (public, no gate, no child data)

`application_lead` is the public write. It carries a parent or guardian email and nothing else identifying a child.

| application_lead | type | notes |
|---|---|---|
| id | uuid | |
| email | citext | parent or guardian email, the only contact datum |
| source | text | where the lead came from |
| status | enum(`new`,`contacted`,`converted`,`deleted`) | |
| chapter_id | uuid fk null | if the form was chapter-specific |
| converted_application_id | uuid fk null | set when a lead becomes an application |
| contacted_at, converted_at, deleted_at | timestamptz null | |

- The public write `submitLead(email, source)` is unauthenticated and inert: it creates one `application_lead` in `new`, no account, no child data. Rate limiting and the bot check are HTTP-layer concerns. Dedupe on `email` within a configurable window.
- Because it holds only a parent email collected to seek consent, its deletion when a lead does not convert within the window is the § 312.4(c)(1)(vii) job: unconverted leads older than the consent-seeking window (30 days, config) are deleted. This replaces the earlier sweep that redacted child PII from stale applications, because there is no longer child PII at this stage.

### Stage 2: application (staff-gated, child data enters here)

A staff member converts a lead into a full `application`, which is where the child's name, grade, school, guardian name, and the signed-form pipeline begin. This is the existing `application` entity and the existing ops review flow (screen, interview, accept, decline, withdraw, reopen), unchanged except that it is created by conversion rather than by the public endpoint.

- `convertLead(leadId, applicationInput, ctx)` is gated through `authorize` under `application.transition` (a lead-to-application conversion is a staff action). It creates the `application` linked back to the lead (`converted_application_id`), sets the lead `status = 'converted'`, and is atomic.
- The `application` no longer has a public creation path. Its retention follows the fuller schedule: contact details age out at active enrollment plus one year per [../compliance-coppa.md](../compliance-coppa.md) 1.5.

### Stage 3: enrollment and onward

Unchanged from the flows in [../06-onboarding-flows.md](../06-onboarding-flows.md): enrollment record, signed-form storage, coupling D, the guardian and student invites, verification, consent, and activation.

## What this changes in the built code (rework)

1. **Add `application_lead`** table and migration.
2. **Rework the public write:** `submitApplication` at the public endpoint becomes `submitLead` creating an `application_lead`. The full `application` creation moves to `convertLead`, staff-gated.
3. **Rework the retention sweep:** `sweepUnconsentedApplications` becomes `sweepUnconvertedLeads`, deleting unconverted `application_lead` rows older than the window and writing the same PII-free `retention.*` audit entry. The child-PII-redaction path over `application` is retired, because the public surface no longer collects child PII.
4. **Update step 1 and retention tests** to the lead model.

## Live-during-paper-period note

Stage 1 lead capture is the only part of Milestone 1 that may run live during the paper period, because it collects no child data. Stages 2 and 3 are built and tested against synthetic data now and go live only when the legal review in [../open-questions.md](../open-questions.md) clears.
