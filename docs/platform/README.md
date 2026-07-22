# CurioLab platform backend: design specification

This is the consolidated design for the CurioLab web platform backend, as reviewed and amended across the planning process. It is the document the build is measured against. Where the reasoning behind a choice matters, it lives in [decision-log.md](decision-log.md), so the spec files below stay declarative.

## What this is

CurioLab is a 501(c)(3) running a multi-semester engineering and programming program for students in grades 6 through 12, working with university mentors at chapter locations starting with Case Western Reserve University. Students progress through three student tiers (Explorer, Builder, Innovator) and may then hold University roles, which are paid, company-like staff positions. The program is multi-chapter by design, with each chapter carrying Seed, Active, or Distinguished status.

This backend serves three surfaces: a public site (marketing, newsletter, curated project directory), The Lab (an internal members-only community feed), and the student profile (verified program data plus student narrative, with a public verification URL). A separate for-profit system called Luminent holds learning records under a licensing agreement and is treated as an external system with a thin, explicit boundary. This backend is authoritative for tier, project verification, mentor hours, and timeline at launch, because Luminent will not be a production record system by the time this ships. See [open-questions.md](open-questions.md) for the Luminent boundary as a proposal.

## The three properties that matter

The architecture is competent but not unusual. What makes it durable for a team of university students on semester-length tenures is three properties, and any change that erodes one of them should be treated as a regression:

1. **Compliance rules live in the database, not in application code.** DOB provenance, form-sourced consent, evidence-backed tier, single active membership, the guardian-invite-equals-form-email binding, and the append-only ledgers are enforced by constraints and triggers, so application code cannot violate them and a new contributor cannot accidentally undo them.
2. **Consent is a peer of role, not a check bolted onto some routes.** The authorization engine evaluates consent in a fixed pipeline step that runs for every actor including platform administrators. A role never outranks a family's consent.
3. **Every "must not" carries a failing-first test.** The test plan is spined on a must-not register, and each guarantee fails a test before it is implemented.

## Reading order

| File | Contents |
|---|---|
| [01-stack.md](01-stack.md) | Language, framework, database, ORM, auth, hosting, email, operations |
| [02-data-model.md](02-data-model.md) | Every entity, its columns, constraints, indexes, and write discipline |
| [03-authorization.md](03-authorization.md) | The single authorization code path, the registry, resolution order |
| [04-state-machines.md](04-state-machines.md) | Lifecycles, transitions, transactional couplings, isolation and locking |
| [05-api-surface.md](05-api-surface.md) | Endpoints grouped by surface, with capability and minor-data flags |
| [06-onboarding-flows.md](06-onboarding-flows.md) | Guardian, student, mentor, staff, coming-of-age, and paper-period import |
| [07-test-plan.md](07-test-plan.md) | Test layers, the authorization matrix, the must-not register |
| [08-build-phasing.md](08-build-phasing.md) | Milestones, ordering, and the fall-on-paper ruling |
| [compliance-coppa.md](compliance-coppa.md) | COPPA findings under the amended rule, the consent-flow build spec, and the retention schedule; authoritative on retention, deletion, and consent separability |
| [decision-log.md](decision-log.md) | What was decided, what was rejected, and why, including the corrections |
| [open-questions.md](open-questions.md) | Items awaiting legal review and items still undecided |
| [paper-period.md](paper-period.md) | Fall 2026 manual process and import-ready form and folder discipline |
| [BUILD-STATUS.md](BUILD-STATUS.md) | What is coded and verified, what needs the operator, and known gaps |
| [plans/milestone-0.md](plans/milestone-0.md) | Milestone 0 execution plan (built and verified) |

## Status

The design is complete and approved, and Milestone 0 is built and verified (see [BUILD-STATUS.md](BUILD-STATUS.md)). The COPPA analysis in [compliance-coppa.md](compliance-coppa.md) resolved the deletion and retention questions and narrowed the legal review to the items in [open-questions.md](open-questions.md). Milestone 1 is being built against local Postgres with synthetic data; it does not go live with real families' data until the legal review clears. The only deliverable with an unmoved deadline is [paper-period.md](paper-period.md).
