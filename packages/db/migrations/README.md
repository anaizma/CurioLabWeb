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
| `0005_enrollment_dob.sql` | Structural: the nullable `enrollment_record.date_of_birth` column (the ruled DOB-provenance rework; decision-log.md "DOB on the enrollment record, reversed and refined"). The plain column only; the guarantees it enables are in `0006`. |
| `0006_dob_write_once.sql` | The DOB-provenance guarantees: the seeding NOT-NULL check (`student_account_id IS NOT NULL OR date_of_birth IS NOT NULL`), and the two write-once triggers on `enrollment_record.date_of_birth` and `account.date_of_birth`. The ONLY bypass is a transaction-local GUC `app.dob_correction = 'on'` (set by the audited `dob.correct` capability), consulted via `current_setting('app.dob_correction', true)`. `CURIOLAB_MIGRATE_UPTO=0005` witnesses the red state (column present, checks and triggers absent). |
| `0007_enrollment_form_signed_at.sql` | Structural: the nullable `enrollment_record.form_signed_at` column, the signature date that anchors the two form-sourced consents (set at coupling D by the enrollment upload). No write-once discipline. |
| `0008_guardian_portal_tables.sql` | The guardian-portal request and fee tables: `payment_ref`, `scholarship`, `export_request`, `deletion_request`, and the one compliance CHECK that a refused deletion must carry a documented reason. |
| `0009_retention_erase_bypass.sql` | The sanctioned erase/redaction bypass for the write-once DOB triggers. Adds a SECOND transaction-local GUC `app.retention_erase = 'on'` (distinct from `app.dob_correction`), consulted via a new `retention_erase_in_progress()` predicate, and `CREATE OR REPLACE`s the two `0006` write-once trigger functions to honour it. Only the deletion fulfillment service (packages/app `DeletionFulfillmentService`) sets it, so it can null/tombstone a DOB during an erase while an ordinary erase stays blocked. `CURIOLAB_MIGRATE_UPTO=0008` witnesses the red state (a flagged erase still blocked; the unflagged control blocked throughout). |
| `0010_application_funnel.sql` | The Milestone 1 v2 application-funnel rework: the enums and two tables for the public funnel — `application_lead` (Stage 1, the public parent-email lead: email/chapter/referral only, no child data, deleted 30 days after collection when unconverted) and `application_draft` (Stage 2 persistence, populated by part B's 2A/2B/2C flow, created here as the table). Structural only; no new compliance trigger (Stage 1 collects no child PII, and the non-identifying 2B allowlist is an application-layer concern). Extends the 0002 Mechanism-A grants to the two new tables for `curiolab_app`, leaving the analytics role denied (a missing grant, since both tables hold contact/child facts). `CURIOLAB_MIGRATE_UPTO=0009` witnesses the red state (the relations do not exist). |

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
