# Migrations

Ordered, hand-authored SQL applied in filename order by the test harness
(`test/helpers/pg.ts`) and, in deployment, by any SQL migration runner.

| File | Contents |
|---|---|
| `0000_base.sql` | Extensions (`citext`), enums, the 16 Milestone 0 tables, foreign keys, the `account` identity check, and the ordinary indexes. The plain structural floor. |
| `0001_guarantees.sql` | The compliance guarantees that must live in the database: the Decision-4 DOB trigger, the form-sourced consent checks (`source_ref`, `scope_ref`, non-future `effective_at`), the single-active-membership partial unique index, the membership shape checks (which cover the alumni shape), evidence-backed `tier_transition` plus the tier-sync trigger (coupling F), the append-only trigger backstop on `consent` and `audit_entry`, the `consent_current` maintenance trigger, the impersonation-of-minor read-only trigger, and the guardian-invite-equals-enrollment-email trigger. |
| `0002_roles.sql` | Mechanism A: the `curiolab_app` and `curiolab_analytics` Postgres roles and their table grants, including the append-only role-level `REVOKE` and the sensitive-table denials. |
| `0003_consent_enrollment_link.sql` | Structural: the `consent.enrollment_record_id` column and its FK to `enrollment_record` — the temporal anchor for a form-sourced grant. The plain column only; the guarantees it enables are in `0004`. |
| `0004_consent_temporal_rule.sql` | The ruled consent change (02-data-model.md): a `signed_form` consent with a null `enrollment_record_id` is invalid, and the temporal trigger (replacing `0001`'s future-only check) floors `effective_at` at the linked application's submission date (`enrollment_record.application_id -> application.created_at`), not the enrollment record's own `created_at`, while keeping the non-future check. `CURIOLAB_MIGRATE_UPTO=0003` witnesses the red state for both. |

## Why the guarantees are separate from the base tables

Each guarantee in `0001` has a red-before-green test. Running the suite with
`CURIOLAB_MIGRATE_UPTO=0000` applies only the base tables, and every guarantee
test then fails because the database accepts the violating row. Applying
`0001` and `0002` turns them green. This is how the tests prove they test the
guarantee rather than an incidental typo.

## Relationship to the Drizzle schema

`src/schema.ts` is the typed data-access projection of the same tables. It is
NOT the source of the DDL here — the compliance guarantees (triggers, partial
indexes, PL/pgSQL, per-role grants) cannot be expressed in a Drizzle schema.
`npm run db:generate` regenerates the *base-table* SQL from the schema and was
used to cross-check that `0000_base.sql` matches the schema column-for-column.

## Mechanism A, and how Milestone 3 extends it

`0002_roles.sql` demonstrates the pattern on tables that exist in Milestone 0:
`curiolab_analytics` is denied `SELECT` on `enrollment_record` and
`guardianship`. The guarantee that "a product lead cannot read a sensitive
table directly" is enforced as a **missing grant**, which is the only version
of that guarantee a test can hold (07-test-plan.md, "coverage boundaries").

When Milestone 3 adds the financial/HR-style tables `payment_ref` and
`scholarship`, extend the same block:

```sql
REVOKE SELECT ON payment_ref  FROM curiolab_analytics;
REVOKE SELECT ON scholarship   FROM curiolab_analytics;
```

and add the mirror-image test: the analytics role's `SELECT` is rejected while
the app role's succeeds.

## Deferred within Milestone 0 (documented, not silently skipped)

- `audit_entry` is created as a plain table. The spec calls for monthly range
  partitioning; the append-only guarantee under test does not depend on it, so
  partitioning is deferred to the deploy/ops milestone.
- The `account` identity-type-by-age/role trigger (a minor student is
  username-only, an adult is email) is not in the Milestone 0 DB guarantee
  test list and needs membership+age context; only the structural
  `CHECK ((email IS NULL) <> (username IS NULL))` ships here.
- `tier_transition`'s "writer resolves to a chapter_director or lead_instructor"
  trigger is not in the Milestone 0 guarantee test list; `evidence_ref NOT NULL`
  and the tier-sync trigger (both listed) ship here.
- The consent temporal rule is now enforced (see `0004_consent_temporal_rule.sql`):
  the `consent` row carries an `enrollment_record_id` linkage (added in `0003`),
  and `effective_at` is floored at the linked application's submission date, not
  the enrollment record's own creation. Both halves (non-future and
  not-before-submission) ship here.
