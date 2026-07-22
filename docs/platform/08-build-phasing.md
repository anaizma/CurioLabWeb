# 08. Build phasing

## Principle

Build the compliance floor before anything sits on it, ship the smallest thing a chapter can legally operate, and defer everything valuable but not load-bearing for safely handling a minor's data. The floor is expensive to retrofit and the team turns over, so it is built and locked by the one person who stays, before undergraduates build features on top.

## The schedule ruling: fall 2026 runs on paper

Milestone 0 (schema, triggers, authorization engine, session auth, audit log, three enforcement guards, deployed environment) plus Milestone 1 (four onboarding flows, an operations back office, a guardian portal) is months of work for one person who is also running the program. The recruitment calendar has intake happening now, and the legal review is a hard gate in front of Milestone 1 that takes weeks on its own.

Therefore the fall 2026 cohort runs on paper: signed forms, a spreadsheet roster, and the documented manual process in [paper-period.md](paper-period.md). Milestones 0 and 1 target the spring 2027 cohort, with the legal review landing well ahead of it. This is the same principle as the rest of the plan: the platform must not touch a real child's data before the floor under it is sound, and a rushed intake system holding real families is worse than no system. Two consequences are designed now, not later: the paper period is import-ready (mapping in [06](06-onboarding-flows.md), discipline in [paper-period.md](paper-period.md)), and the same guarantees run as a documented manual process during the paper period.

## Milestone 0: The floor (the founder builds and locks this)

Not user-facing. The spine every feature hangs off, built first because retrofitting it is the expensive failure mode.

- The schema for `account`, `chapter`, `term`, `membership`, `guardianship`, `consent`, `consent_current`, `enrollment_record`, and `audit_entry`, with the database guarantees: the decision-4 DOB trigger, form-sourced consent checks, single-active-membership index, append-only enforcement, and the constraints from [02](02-data-model.md).
- The `can` and `authorize` two-layer over the registry, session authentication (username or email, argon2id, opaque Postgres sessions), and the audit log.
- The enforcement guards from [07](07-test-plan.md): the route manifest, the runtime authorization backstop, and the registry completeness meta-test.
- **Mechanism A, role and credential separation**, alongside the schema it protects. This is the answer to the product-lead problem and has no hot-path cost, so it belongs here and not in Milestone 4.
- The deploy target: one container, managed Postgres, R2, Resend domains split transactional from bulk, pg-boss.

Acceptance: the must-not register for every capability that exists yet, failing-first then green. Nothing real is collected in this milestone.

## Milestone 1: The operational core (the defensible first milestone)

A Chapter Director can take a real family from application to an activated, consented student, and a guardian can see and control their child's data. That is the COPPA-operable path, end to end.

- Flows A, B, C, and E in full, including the `in_person_witnessed` path and the self-disabling seed.
- The ops back office for exactly those flows. Unglamorous CRUD, and the whole product at this stage.
- The guardian portal: view the child's record, view fees status, manage consents, and file export and deletion requests. Request intake ships here even though tiered fulfillment tooling comes later, with staff performing fulfillment manually and audibly in the interim.
- Impersonation for support and the safeguarding consent path.
- **The incident runbook**, a written document in the repository: how to revoke all sessions at once, how to determine what a compromised account could reach using the audit log, who is called, and what the notification says (the vision document commits to notifying the national org within 24 hours of a suspected breach and affected families within 72). It ships here because this is when real families first exist.

Out of scope here: the feed, projects, profiles, the public site, the newsletter. A spring cohort student works with their mentor while this milestone carries the legal weight.

Hard gate: the legal review lands before a single real family enters Milestone 1, covering the items in [open-questions.md](open-questions.md). Milestone 1 does not go live with real data until that review clears.

## Public site and staff newsletter: ships early, independent of the backend

A static public site plus a staff-authored newsletter with zero student-authored items touches no minor data, needs no consent gate, and depends on nothing in the floor (`platformGrant` already encodes the zero-student case). The three HTML mockups exist. This ships before or alongside Milestone 0, so the program has a public presence and grant and recruitment evidence during the paper period, which is exactly when it needs one. Student projects are added manually with consent verified on paper until Milestone 3 automates it.

## Milestone 2: The Lab

The internal feed once intake works: posts, comments, reactions, pods, filters, the moderation-report lifecycle with the SLA and escalation, `feed.hide_safety`, and the system-generated milestones and timeline entries that solve the empty-state problem. Additive on the `platform_participation` gates already in the floor.

## Milestone 3: Profiles, projects, and the automated public surfaces

The student profile with the verified-and-narrative split and narrative moderation, the project lifecycle, the verification URL and its token, the automated public project directory, and the newsletter automation with drafting, the publish gate, subscribers, and the webhooks.

## Milestone 4: Scale and advanced compliance operations

Onboarding a second chapter as the multi-chapter proof, **Mechanism B (per-request row-level security)** as defense in depth, tiered deletion fulfillment tooling, the maturation staff-confirm flow with its backstop and recovery, and the Luminent sync boundary once Luminent exists. Two pieces cannot wait if the calendar forces them: the automatic age-18 write-authority flip is free from the decision-time age logic in the floor, and deletion request intake already ships in Milestone 1, so a student turning 18 or a family requesting deletion during a cohort is handled, manually if need be, rather than blocked.

## Why this order

The floor comes first because it is the part undergraduates must not build and must not build on before it is stable. The operational core comes second because collecting a minor's personal information safely is the gating legal act, and a chapter that can only do intake is still a chapter that is operating. Engagement comes third because it is where students spend time and is safe to build only once consent gates it. The automated public and verification layer comes fourth because it faces outward and should not until the inward parts are sound. Scale and advanced compliance operations come last because the second chapter proves the membership model was worth its cost, by which point the model has been exercised by a real cohort rather than by a diagram.
