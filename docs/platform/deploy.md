# Deployment (Milestone 1)

This documents the deploy target and what it needs. It is deliberately not wired into the repo root, because the existing marketing site has its own deployment and the platform backend should not silently take it over. The templates live in [deploy/](deploy/).

**Status: not provisioned.** Everything below is the checklist and the templates to do it, not a completed deploy.

This revises the Milestone 0.5 version of this document against what's actually built, per an audit run 2026-07-26 (`packages/db`, `packages/app`, `packages/runtime`, `packages/http`, and vendor documentation for Fly, Neon, Cloudflare R2, and Resend). Where the audit found the earlier reasoning wrong, it's corrected here rather than quietly dropped — see [decision-log.md](decision-log.md)'s own precedent for this (the "Next.js fork" correction).

## Corrections to the earlier reasoning

1. **The "always-on over serverless because RLS wants pinned connections" argument doesn't hold.** `withRlsContext` (`packages/runtime/src/rls.ts:42-57`) uses `SET LOCAL` inside an explicit `sql.begin()` transaction — transaction-scoped, resets at commit, safe under PgBouncer/transaction-mode pooling by construction. It does not need a pinned connection. The always-on choice still stands, but on its other two legs: real background work once the sweeps are wired (below), and one process being easier for a rotating team to reason about.
2. **Cloudflare R2 cannot contractually pin storage to a single US region.** Its only hard "Jurisdictional Restriction" options are `eu` and `fedramp`; the US options are "Location Hints," which Cloudflare's own docs call best-effort, not a guarantee. If a hard region guarantee is required for signed enrollment forms specifically, the alternative is a single-region AWS S3 bucket for that one bucket, at the cost of R2's free egress. Get counsel's read on whether "best effort" satisfies the § 312.8(c) "reasonable steps" standard before treating this as settled either way.
3. **Fly's region pinning is operator-configured, not platform-guaranteed** — its scheduler can fall back to other regions in a list. Set `primary_region` explicitly in `fly.toml` and don't treat it as a contractual guarantee the way Neon's region pinning is.
4. **The Resend webhook route's signature check is a generic HMAC, not Resend's real Svix-based scheme** (`packages/http/src/webhook-signature.ts:28-42` — the code's own comment calls it a "simplified configurable-HMAC contract"). Verify it against Resend's actual signing format before relying on it in production; see the staging-verification step below.

## Target

Per [01-stack.md](01-stack.md): a single always-on Node container in one US region, running the app and the pg-boss worker, with managed Postgres, private object storage, and Resend for mail.

**As of this audit, nothing currently running requires an always-on process** — `pg-boss` is not a dependency anywhere in the workspace (not installed, not just unscheduled), and all seven sweep/background job bodies (`sweepExpiredLeads`, `runTimeBoxSweep`, `runEligibilitySweep`, the moderation escalation sweep, scheduled newsletter publish, the maturation backstop, `runDmFreezeOnDeparture`) exist only as pure functions invoked from tests. The always-on target is still the right thing to provision for, because wiring those sweeps is near-term work and is a real prerequisite before real family data (see the gate at the bottom) — but don't read "always-on" as something the current code demands today.

- Managed Postgres with point-in-time recovery of at least 30 days and encryption at rest. Confirm the chosen Neon plan tier actually gives 30-day PITR — lower tiers may default to less.
- Private, S3-compatible object storage for signed enrollment forms and media, reached only through short-lived signed URLs, with audited retrieval. **Not yet buildable as specified** — see the R2 section below.
- Background and scheduled work on pg-boss (Postgres-backed), so no Redis. **Not yet installed** — see the pg-boss wiring note below.

## Two gates, not one

Everything through "Staging deploy" below is required to run the app against **synthetic data only**. A separate, harder gate — the last section of this document — must clear before **any real family's data** reaches production. Keep them distinct: most of this checklist is provisioning and ops work a solo founder can do today; the final gate mixes legal sign-off with code that hasn't shipped yet, and conflating the two makes it easy to miss one.

## 1. Vendor accounts, DPA first

For each vendor, get the DPA in hand before creating any resource that could touch a real family's data (synthetic-data staging doesn't need to wait on this, but do it early — it's free and self-serve for all four, no sales contact required):

| Vendor | DPA | Notes |
|---|---|---|
| Fly.io | [fly.io/documents](https://fly.io/documents/) — sign in, request, they countersign | Also grab their BAA if ever relevant |
| Neon | [neon.com/dpa](https://neon.com/dpa) — auto-incorporated into the ToS, also separately downloadable | |
| Cloudflare | [cloudflare.com/cloudflare-customer-dpa](https://www.cloudflare.com/cloudflare-customer-dpa/) — covers R2 under the general Cloudflare DPA | Decide the R2 region question (correction #2 above) before or alongside this |
| Resend | [resend.com/legal/dpa](https://resend.com/legal/dpa) — incorporated by reference into the ToS, includes SCCs + DPF certification | |

Record each as dated and obtained in [compliance/vendor-dpa-checklist.md](compliance/vendor-dpa-checklist.md) — that file gates real data, not staging.

## 2. Neon setup

- Create a Neon project pinned to a single US region. Confirm in the Neon console that this covers branches and PITR/backup data too — Neon's own docs state a project's region covers all of that, not just the primary write path, which is the strongest residency story of the four vendors here.
- New projects default to Postgres 17, matching the `embedded-postgres@17.10.0-beta.17` the `db` package's tests run against (`packages/db/package.json:32`). No extension gap: the only extension the schema uses anywhere is `citext` (`packages/db/migrations/0000_base.sql:12`), which Neon supports without restriction.
- Run the migrations in `packages/db/migrations` in order (`npm run db:migrate`, which reads `DATABASE_URL` from env — the same command works against any environment by changing that one var). This creates the `curiolab_app` and `curiolab_analytics` roles (`0002_roles.sql`) and, later in the sequence, `curiolab_rls` (`0018_rls.sql`).
- **Connection strings — use Neon's pooled endpoint for both `DATABASE_URL` and `DATABASE_URL_ANALYTICS`.** Per correction #1, nothing in this codebase needs the unpooled path. Authenticate as `curiolab_app` and `curiolab_analytics` respectively — **not** the Neon default/owner role. This is the one item worth stating plainly: right now, even in local dev, the app connects as the Postgres superuser (`.env`'s `DATABASE_URL` is `postgres://postgres:postgres@...`), which bypasses both Mechanism A and Mechanism B entirely. Get this right in every real environment before treating role separation as an active control anywhere.
- **Decided (2026-07-26): Mechanism B (RLS) ships to staging unwired, as a hard gate before real families — not a "decide later."** It's fully built and tested against the `curiolab_rls` role (`packages/db/test/rls.test.ts`, `packages/runtime/test/rls-context.test.ts`) but is not imported anywhere in `packages/app`, `packages/http`, or `app/api/**` today. The full file-by-file wiring plan is written and ready to execute: [docs/superpowers/plans/2026-07-26-rls-live-path-wiring.md](../superpowers/plans/2026-07-26-rls-live-path-wiring.md) — 40 tasks, TDD per file, dark-safe the entire way (nothing in a real environment changes until the very last task strips `BYPASSRLS` from `curiolab_app`). Do not run that plan's final migration (`0042`) against staging or production until its own Task 40 gate passes.
  - **What "the database protects this as a fallback" actually means today, precisely:** Mechanism A (role separation — `curiolab_app` lacking certain grants) is real and already designed, but it is table-level, not row-level. It stops an analytics-role connection from reading `enrollment_record`/`guardianship` at all; it does **not** stop a logic bug in the app itself from returning chapter B's data to a chapter A director, which is exactly what Mechanism B exists to catch. Mechanism A is only a real fallback once the app actually connects as `curiolab_app` rather than a superuser (the prerequisite already flagged above) — confirm that's true in staging before treating this gate as "covered in the meantime."

## 3. R2 bucket, private

Two separate things need to be true before this is real, and neither is provisioning:

- **Region decision** (correction #2): either accept R2's US "Location Hint" as sufficient with a documented rationale, or move the signed-forms bucket to a single-region S3 bucket instead. Don't default silently to R2 without making this call on the record.
- **The code doesn't exist yet.** `R2StorageAdapter` (`packages/app/src/storage.ts:98-118`) is an explicit stub — every method throws `notImplemented()`. No S3-compatible client library (`@aws-sdk/client-s3` or equivalent) is even a dependency. `getSignedUrl` is called nowhere in production code. And Cloudflare's own audit logs don't cover `GetObject`/`PutObject` at all (object-level access logging needs paid Logpush, and even that only covers public-bucket HTTP requests) — so "audited retrieval" has to be application-level: a write to `access_ledger` on every signed-URL issuance, which also doesn't exist yet.

Once the region decision is made and the adapter is real: create a private bucket, no public access path, access only via short-lived signed URLs or server-side calls, and confirm the access_ledger write lands before any real form is uploaded.

## 4. Resend domain and DNS

- Authenticate the sending domain: SPF, DKIM, DMARC, all required, all before the first real invite. This is already correctly scoped in the design.
- Use a dedicated transactional subdomain (e.g. `notify.curiolab.org`) separate from any future newsletter subdomain, so a newsletter complaint can't poison invite deliverability — this matches Resend's own stated guidance to isolate subdomains by sending purpose.
- Point the bounce/complaint webhook at `/api/webhooks/resend`. The route and DB-side dedup exist and work (`packages/http/src/controllers/webhooks.ts:166-187`), but two things need attention before this is trustworthy in production:
  - **Verify the signature check against Resend's actual Svix-based format** (correction #4) — the current implementation is a generic HMAC contract, not confirmed to match what Resend actually sends.
  - **Wire the surfacing that doesn't exist yet.** A hard bounce or complaint currently updates a `delivery_status` column on `newsletter_subscriber`/`invite` and nothing else — no route, ops controller, or UI reads that column today. `01-stack.md` promises this reaches the Chapter Director queue; build that before relying on it.
- Point the Stripe webhook at `/api/webhooks/stripe` (route exists, `packages/http/src/controllers/webhooks.ts:216-232`, same dedup pattern) and store the signing secret.

## 5. Secrets

Populate every value in [deploy/env.example](deploy/env.example) into the host secret store, never the repo — that file has been corrected to match what the code actually reads (it previously listed several vars nobody consumes and was missing several the code does read: the three REVIEW-GATED feature flags, `DM_ENCRYPTION_KEY`, `APPLY_FROM_EMAIL`, `DIRECTOR_NOTIFY_EMAIL`, `NEXT_PUBLIC_SITE_URL`). No hardcoded secrets exist anywhere in the repo today — keep it that way. Rotate any shared secret when a contributor offboards.

Leave the three REVIEW-GATED flags (`CONSENT_GRANT_LEDGER_ENFORCED`, `MENTOR_ELIGIBILITY_ENFORCED`, `MENTOR_DM_ENABLED`) at their code default (`false`) in every environment until the corresponding counsel/board sign-off in `BUILD-STATUS.md` has actually happened — flipping one is a legal event, not a deploy step.

## 6. Staging deploy, migrations, RLS verification

1. Build from [deploy/Dockerfile.example](deploy/Dockerfile.example). Note it currently targets `packages/runtime/dist/server.js`, which doesn't exist — the app runs via `next start` today. Adapt the `CMD` before this Dockerfile is real, and build the `/healthz` route the `HEALTHCHECK` directive expects (also doesn't exist yet).
2. Run migrations against the staging Neon project.
3. Confirm the deployed app connects as `curiolab_app`, not a superuser — check the actual role via `SELECT current_user;` against the staging DB from within the running app, don't just trust the connection string.
4. If Mechanism B has been wired per step 2 above: run one concurrent-request smoke test against Neon's pooled endpoint (two simultaneous RLS-context requests, different account IDs) and confirm no cross-contamination. Neon's docs warn about session-level `SET` under pooling but don't explicitly bless `SET LOCAL` by name, so this is worth the five minutes even though the mechanism should be sound by construction.
5. Confirm the health check responds and the app connects to Postgres as the restricted role.

Staging runs on synthetic data only — never a production restore (see gate below).

## 7. Backups and the restore drill

Managed Postgres PITR covers disaster recovery — confirmed available on Neon, pending the plan-tier check noted above. Separately, schedule the quarterly restore drill from [07-test-plan.md](07-test-plan.md): restore into an isolated environment with production-equivalent access controls, time-boxed, destroyed after verification, with the restore writing an audit entry. This is a scheduled human action today, not automated anywhere in the repo — put it on a calendar, not just in this doc.

Test and CI databases use synthetic data only, never a production restore. This audit confirmed there is no code path anywhere in the repo — no seed script, no migration, no NODE_ENV-branching — that could pull production data into a non-production environment. Keep it that way: never add environment-name branching to the app's DB connection logic: today `DATABASE_URL` is read unconditionally with zero conditionals, and that's the safest possible shape.

## Final gate: what's required before a real family's data

Split deliberately into two lists, because conflating them is how a real family's data ends up in the system before it should.

**To deploy to staging with synthetic data — nothing but the stack itself, plus:**
- `/healthz` built (doesn't exist)
- the app actually connecting as `curiolab_app`, not a superuser, in the deployed environment

**Before a single real family record is allowed in production, all of the following, with no exceptions:**

*Legal / vendor (unchanged from the original plan):*
- The legal review (open-questions.md L1-L5)
- The § 312.8(b) written information security program, coordinator named, placeholders filled
- The § 312.10 retention policy, published in the privacy notice
- The four vendor DPAs, each dated and checked off in `vendor-dpa-checklist.md` (not just obtainable — obtained)

*Technical, surfaced by this audit — not gated by counsel, but just as hard a stop:*
- **Mechanism B (RLS) must be wired onto the live app path.** Decided 2026-07-26: staging ships without it (synthetic data only, so the exposure is nothing), but no real family's data goes in until it's live. Full 40-task plan: [docs/superpowers/plans/2026-07-26-rls-live-path-wiring.md](../superpowers/plans/2026-07-26-rls-live-path-wiring.md). Until then, the only defense against a cross-chapter/cross-family data leak from an application bug is Mechanism A (table-level role grants) — real, but not row-level; see the note under "Neon setup" above.
- The § 312.4(c)(1)(vii) 30-day application-lead deletion sweep must actually run somewhere in production. Today it's an untriggered function; this is a legally load-bearing control, not an ops nicety.
- R2 (or its replacement) must move from a throwing stub to a real implementation with application-level audited retrieval, before any signed enrollment form is stored.
- The Resend webhook signature check should be confirmed against Resend's real scheme, and bounce/complaint status should reach a human queue, not just a silent column.
- Rate limiting on the unauthenticated write set (application, password reset, newsletter subscribe) — explicitly deferred in the code today, called out as an edge/middleware concern that hasn't been built.

The app has no hard dependency that forces real data in before these clear — every one of the above can be fixed independently of provisioning, and none of it blocks the synthetic-data staging deploy above. The risk isn't that the code forces early real-data use; it's that "provisioned" and "safe for real families" can look the same from the outside if this list isn't checked explicitly.
