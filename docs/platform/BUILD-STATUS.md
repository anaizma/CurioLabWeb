# Build status

The morning ledger of the overnight build. Everything below I ran and verified myself; no claim is unrun. Branch `feat/platform-m1`, pushed to GitHub.

## Verified state

**863 tests green** across five packages: core 138, db 167, runtime 29, app 368, http 161. Full workspace run ~1m50s on the shared-Postgres-per-package harness (one embedded Postgres per package on an ephemeral port; per-file template-clone databases). Root `next typegen && tsc --noEmit` clean across all ~90 `app/api` route handlers.

## What is done and verified

| Area | State |
|---|---|
| **M0 — the floor** | Authorization engine, schema + DB guarantees, Mechanism A, sessions + audit + enforcement guards. |
| **M1 — operational core** | Application funnel (parent-email lead + three-phase Stage 2, aligned to your Stage-1 design), enrollment + coupling D, invites, guardian verification, consent (3 blocks + § 312.7), DOB provenance + `dob.correct`, activation, guardian portal, tiered deletion + export, retention sweep, HTTP. |
| **M2 — The Lab** | Feed, posts/comments/reactions + lifecycle, feed read + filters + out-of-pod minor-read logging, moderation (generated SLA, lifecycle, `feed.hide_safety`, escalation job), milestones + timeline (empty-state), Lab HTTP. |
| **M3 — profiles, projects, public, newsletter** | Project lifecycle + coupling C2, profiles + narrative moderation + neutral verification URL, media + photo-review + coupling C1, newsletter (publish gate, coupling E, blocked, redaction), subscribers + double opt-in, Resend/Stripe webhooks (signature-verified, idempotent), M3 HTTP + public reads. |
| **M4 — scale + advanced compliance (buildable parts)** | Maturation flow + 90-day backstop + `account.recover` + 16+ `self_private`; per-request RLS (Mechanism B) on the high-risk tables; second-chapter isolation proof (no leak; multi-membership resolution verified). |
| **Post-M4 hardening** | Deferred auth/onboarding/account-lifecycle/audit HTTP routes; `impersonation.start` + `audit.view` made first-class capabilities; `guardianship.revoke` + safeguarding consent suspension; guardian-portal revoke now fires C1/C2; `credential_token` store making password reset + account recovery functional; org management (chapters/terms/pods CRUD); the build-time route-manifest guard (both invariant guards now active). |

## P5 — time-boxing of volunteer/staff access (§7)

Former-mentor/instructor/volunteer access closes automatically at term end rather than lingering. This phase was mostly **confirm-and-close-gaps**: the decision-time half already existed; the missing half was making the closure a real, auditable, roster-visible status flip.

**Already existed (confirmed, not rebuilt):**
- `can`'s `inForce` (`packages/core/src/can.ts`) already treats a membership that is not `status = 'active'` (or is outside its `[active_from, active_until)` window) as conferring **no** capability — `pickMembership` skips it, so every student-facing capability denies. Decision-time term-end/expiry was already in place.
- The membership state machine already defines the `active -> inactive` "window elapsed — system bookkeeping, no capability" edge — the exact legal edge a term-end sweep takes.
- The `membership` row already carries `term_id` (term linkage), `active_from`, `active_until`. **No migration was needed.**
- `writeAudit` + `writeAccessLedger` (`@curiolab/runtime`) already exist.

**Added this phase:**
- **`runTimeBoxSweep({ sql }, now)`** — the job body (`packages/app/src/time-box-sweep.ts`). In one transaction it flips every **privileged** (non-student/alumni, via `PRIVILEGED_ROLES`) membership that is still `active` but whose bound term's `ends_on` is before `now` (`t.ends_on < now::date` — a member keeps access through the end date itself) from `active -> inactive`; clears its pod links (deletes its `pod_assignment` rows, nulls `membership.pod_id`, and nulls any `pod.mentor_membership_id` pointing at it); and writes a **system-actor** (`actor = null`) `audit_entry` (`action = membership.time_box_revoked`) + `access_ledger` row (`event = membership.time_box_revoked`), each carrying `reason = term_ended` and references only (no PII). Returns `{ revokedCount, revokedMembershipIds }`. **Idempotent** — an already-`inactive` row no longer matches, so a re-run writes nothing.
- A new `AccessLedgerEvent` value `membership.time_box_revoked` (`packages/runtime/src/ledger.ts`). The ledger `event` column is `text`, so no DB migration.

**Scope guardrails:** STUDENT (and alumni) memberships are never time-boxed here — students lapse via graduation/maturation, a separate flow. No new HTTP endpoint or capability was added: a manual per-membership director offboard was left out deliberately (the existing registry has no `member.offboard`; reusing `member.activate` would be semantically wrong, and inventing a capability for an optional surface is out of scope for P5). pg-boss scheduling of the sweep stays a separate go-live wiring step (see below).

**Tests:** `packages/app/test/time-box-sweep.test.ts` (5, embedded-Postgres, deterministic clock) — ended-term mentor flips / current-term mentor untouched; `can` denies a lapsed mentor the `student.view_record` an active mentor is allowed; per-revocation audit + access-ledger rows with `reason = term_ended` and a second run idempotent; a student membership is untouched; a lapsed mentor's pod assignment is cleared.

## Notable behavior change to review

- **Guardian reads of an 18+ child persist until the edge lapses.** The age-18 bar was corrected to guardian *writes* only, so a guardian still *reads* their 18+ child's record during the maturation window (soft landing), ending at staff-confirm or the 90-day backstop. Matches 04-state-machines / Flow D; loosens an M1 behavior on purpose. See `packages/core/src/can.ts`, `maturation.ts`.

## Findings the route-manifest guard surfaced (worth reconciling, not bugs)

- **Two self-service writes gate outside the registry:** `POST /api/auth/email/add` and `POST /api/ops/students/[id]/self-private` are gated by self-ownership + age (+ non-guardian witness) inside the service, not through a registry capability. They are safe but sit outside the literal "every actor'd mutating route goes through one `authorize` call" invariant.
- **05-api-surface's "entire attack surface" table under-enumerates** the stranger-reachable writes: the Stage-2 funnel routes, `auth/login|logout`, `DELETE /auth/impersonate`, and `account-recovery` are legitimate but not in that 9-row table. The doc should be reconciled to match the manifest.
- **`POST /api/contact`** (a frontend marketing form that sends email) is not in 05-api-surface at all.

## Blocked on external inputs (not code, not faked)

- **Luminent sync** — Luminent does not exist yet (external, mid-build). Boundary documented only.
- **Live deploy** — needs Fly/R2/Resend/Stripe credentials. Templates in [deploy.md](deploy.md).
- **Production data** — the legal review (open-questions L1-L5) gates real families' data reaching production. All code is tested against synthetic data only.
- **Frontend React UI** — `/apply`, profile, and public-directory pages are yours; the backend/services/API are built.

## Deferred go-live wiring (documented, low-risk to add later)

- **Mailer** — every send is a seam (invites, Stage-2 tokens, receipts, newsletter, password reset, recovery); the `resend` dep is installed; delivery needs the key + authenticated domains.
- **Activate RLS on the app path** — policies + `withRlsContext` exist and are proven via the `curiolab_rls` role; connecting the app as that role and threading the per-request GUC through every read is a deliberate broad refactor, not done overnight.
- **Job scheduling** — the sweep/escalation/scheduled-publish/backstop/time-box job bodies exist (incl. `runTimeBoxSweep`, §7); pg-boss scheduling is a wiring step.
- **Rate limiting** on the unauthenticated write set — an edge/middleware concern.

## Open questions for you (small, non-blocking)

- Per-role scope tightening isn't expressible in `can` today (it picks one membership by resource scope): post `remove` and `project.verify` are gated by capability/scope, not the prose's narrower director-only / own-pod-only. A `can` extension would close these if wanted.
- Role-set confirmations: `newsletter.draft` widened to senior/lead instructors + comms + director; `narrative.review` is lead + director.
- One controller (`PATCH /ops/newsletter/[id]` body edit) touches SQL directly (no `NewsletterService.edit` yet).

## How to run

- All tests: `npm run test --workspaces` (~1m50s). One package: `npm run test --workspace=@curiolab/db`.
- DB tests download an embedded Postgres on first run; no Docker needed.
- Route guard: `npm run test --workspace=@curiolab/http` (the manifest test fails if a new mutating route is unlisted).
