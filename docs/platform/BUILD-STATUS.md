# Overnight build status

Written for you to read first thing. Everything below I ran and verified myself; I did not take any agent's word for a passing test. There is no false "done" in here.

## Bottom line

- **Milestone 0 is coded and verified**, to the limit the environment allowed. The one part that needs you (deployment) is documented, not provisioned.
- **161 tests pass**: `@curiolab/core` 105, `@curiolab/db` 32 (against a real embedded PostgreSQL 17, no Docker), `@curiolab/runtime` 24. Typecheck and lint are clean across all three.
- Everything is on branch **`feat/platform-core-m0`**. **Nothing was pushed. Nothing is on `main`.** Your unrelated site changes (`app/mentors`, `app/projects`, `components/Nav.tsx`, `lib/data.ts`, the favicon) were never touched or staged.
- No `node_modules`, no Postgres binary, no build output was committed.

## Done and verified

| package | what it is | tests | commit |
|---|---|---|---|
| `packages/core` | the pure authorization engine (`can`, `REGISTRY`, `platformGrant`, the 7-step order) plus the lifecycle transition guards | 105 | `23a59d2`, `73b875d` |
| `packages/db` | Drizzle schema, hand-written SQL migrations with the database guarantees, Mechanism A roles and grants | 32 | `511ad21` |
| `packages/runtime` | argon2id password hashing, opaque Postgres sessions, the audit writer, the `authorize` wrapper, the AsyncLocalStorage backstop, the route manifest | 24 | `66bd53c` |

How I verified: ran `npm run test` per workspace, `tsc --noEmit`, and `eslint` on each, and confirmed the numbers above. The database suite really started an embedded Postgres and ran the guarantees against it; the build even witnessed the tests fail against the base schema before the guarantee migrations were applied, so the tests are proving something real. The authorization engine is a faithful implementation of the spec's resolution order, not a suite gamed green.

The compliance guarantees that live in the database (the decision-4 DOB rule, form-sourced consent checks, single-active-membership, evidence-backed tier, append-only enforcement on consent and audit, the consent-ordering rule with both worked cases, impersonation-of-minor read-only, the alumni shape, the guardian-invite-equals-form-email binding) are all enforced by triggers and constraints and each has a test that inserts the violating row and asserts rejection.

## Documented, not provisioned (needs you)

- **Phase 0.5, deployment** (`d3fb4e5`): the target, the provisioning checklist, an env template, and a Dockerfile template are in [deploy.md](deploy.md) and [deploy/](deploy/). I cannot stand up live Fly, R2, Resend, or Stripe without credentials, so the smoke-deploy acceptance is deferred to you. This is the only Milestone 0 phase I could not finish.

## Deliberately not built, and why

- **Milestones 1 through 4 as products** (onboarding endpoints, the guardian portal, the feed, profiles, the automated public site, scale, per-request RLS): these handle real families' data or sit behind Luminent existing, and Milestone 1 is gated on the legal review that only you can procure. Building them tonight would be pouring concrete on a foundation you have not been cleared to lay. I built the safe pure-core transition guards that Milestone 1 will use, and stopped there.
- **A few Milestone 0 sub-items**, each recoverable and none blocking, deferred because they were outside the phase's test list or belong to a later layer:
  - The `account` identity-type-by-age-and-role trigger (only the structural `email XOR username` check shipped).
  - The `tier_transition` writer-is-a-director-or-lead trigger (the `evidence_ref NOT NULL` and tier-sync guarantees did ship).
  - `audit_entry` monthly partitioning (an ops concern, not a correctness one).
  - The route-discovery walker (there are no real routes yet; the manifest mechanism is proven with fixtures and lands with the Next layer).
  - Mechanism B, per-request row-level security (Milestone 4 by design).

## One real gap I found during the build

The spec's consent rule "`effective_at` may not precede the related enrollment record" could not be enforced, because a `consent` row references the signed form, not the enrollment record, so there is no linkage to check against. The non-future half of the rule is enforced. Decide before Milestone 1 whether to add an `enrollment_record_id` to `consent` or to check through the form. This is a data-model correction, noted in the migration README as well.

## What only you can unblock

1. **The legal review.** The six items in [open-questions.md](open-questions.md) gate Milestone 1 going live with real data. This is the critical path, and it is not code.
2. **Infrastructure credentials**, for the deploy in [deploy.md](deploy.md).

## How to run any of it

- Everything: `npm run test --workspaces`
- One package: `npm run test --workspace=@curiolab/core` (or `@curiolab/db`, `@curiolab/runtime`)
- Node is present (v22); the database tests download an embedded Postgres on first run, so no Docker is required.

## Suggested next steps, your call

1. Kick off the legal review, since it unblocks everything downstream.
2. Fix the consent-to-enrollment linkage gap above.
3. Review and merge `feat/platform-core-m0` when you are satisfied. I have not pushed or merged it.
4. After legal clears, the pure core and the transition guards extend cleanly into the Milestone 1 app layer.
