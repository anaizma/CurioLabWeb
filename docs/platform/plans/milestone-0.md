# Milestone 0 execution plan: the floor

Milestone 0 is the compliance floor from [../08-build-phasing.md](../08-build-phasing.md). It is not user-facing. It is built and locked before any feature sits on it. This plan decomposes it into test-first tasks with per-task acceptance criteria. Every task follows RED then GREEN then REFACTOR: the failing test lands first.

The reference specs are [../02-data-model.md](../02-data-model.md), [../03-authorization.md](../03-authorization.md), and [../07-test-plan.md](../07-test-plan.md). Where this plan and a spec disagree, the spec wins and this plan is corrected.

## Phase 0.1: Tooling and repo structure

- A workspace with a framework-agnostic `packages/core` package: TypeScript, ESM, Node 20, targeting no Next.js and no HTTP imports.
- A test runner (Vitest), TypeScript strict mode, ESLint.
- Acceptance: `npm test` runs and a trivial placeholder test passes; `packages/core` imports nothing from `next` or the app.

## Phase 0.2: The authorization core (pure, test-first, the crown jewel)

Build `can` and the registry exactly as specified in [../03-authorization.md](../03-authorization.md).

- Types: `Role`, `Capability`, `Scope`, `CapabilityDef`, `AuthContext`, `Resource`, `Decision`, `DenyReason`, `SubjectConsentReq`.
- `REGISTRY`, encoding the capabilities and their scope, roles, consent, and conditions from the spec.
- `platformGrant`, consulted only at scope and role.
- `can(ctx, capability, resource)` implementing the seven-step resolution order verbatim, including the actor and subject consent gates with no override branch, decision-time expiry against `ctx.now`, and fail-closed `subject_consent_unknown`.
- Tests, failing-first: the core-layer rows of the must-not register from [../07-test-plan.md](../07-test-plan.md) (1, 5, 6, 7, 7b, 10, 11-core, 12, 13, 14, 18, 19, 20, 22, 26-core, 27, 28, 29, 30), the two worked sweeps (feed.comment, newsletter.publish), and the registry completeness meta-test (every capability has at least one allow and one deny; every role appears as an actor fixture).
- Acceptance: every core-layer must-not test green; the registry completeness meta-test green; `can` is pure (no IO, no imports outside the core package).

This phase is the first slice to implement. Stop and review after it.

## Phase 0.3: Data schema and database guarantees (needs a Postgres decision first)

- Drizzle schema for the Milestone 0 entities: `account`, `chapter`, `term`, `membership`, `guardianship`, `consent`, `consent_current`, `enrollment_record`, `session`, `invite`, `audit_entry`.
- Raw SQL migrations for the guarantees: the decision-4 DOB trigger, the form-sourced consent check, the single-active-membership partial index, evidence-backed `tier_transition`, append-only enforcement on `consent` and `audit_entry`, the impersonation-of-minor read-only trigger, and the `consent_current` maintenance trigger.
- Mechanism A: separate Postgres roles with table grants.
- Tests against a real Postgres (Testcontainers or a local instance), matching the database guarantee tests in [../07-test-plan.md](../07-test-plan.md).
- Acceptance: every database guarantee test green.

## Phase 0.4: Session auth, audit, enforcement guards

- argon2id hashing, session create, validate, and revoke against the `session` table, opaque token with stored hash.
- The audit writer.
- The `AsyncLocalStorage` authorization context and the repository write backstop that throws when no decision is recorded, plus the build-time route manifest test scaffold.
- Acceptance: session lifecycle tests green; the backstop throws on an unauthorized write in a test.

## Phase 0.5: Deploy target

- The single container, managed Postgres, R2, Resend domains, and pg-boss stood up. Documented, provisioned, not necessarily automated.
- Acceptance: a smoke deploy runs the health check and connects to Postgres.

## Order and checkpoints

Implement 0.1 then 0.2 as the first reviewable slice, because they are pure TypeScript and carry the most compliance value with the least risk. Review before 0.3, which needs a Postgres and Testcontainers decision. Do not begin anything that collects real data before the legal review in [../open-questions.md](../open-questions.md) clears; none of Milestone 0 collects real data, so Milestone 0 is not blocked by that gate, but Milestone 1 is.
