# Build status

Current snapshot of the overnight build. Everything below I ran and verified myself; no claim is unrun. Branch `feat/platform-m1`, pushed to GitHub.

## Verified state

**819 tests green** across five packages: core 135, db 167, runtime 29, app 350, http 138. Full workspace run ~1m50s on the shared-Postgres-per-package harness. Root `next typegen && tsc --noEmit` clean across all `app/api` route handlers.

Post-M4 hardening also landed: the deferred auth/onboarding/account-lifecycle/audit HTTP routes (invite accept, impersonation, maturation confirm, account recover, self-private, audit views); `impersonation.start` and `audit.view` made first-class registry capabilities (restoring the single-code-path invariant); `guardianship.revoke` and the safeguarding consent suspension built; a fix so the guardian portal's own consent-revoke fires the C1/C2 cascades; and a `credential_token` store making password reset and account recovery actually functional (persisted, consumable, session-revoking, no-oracle).

| Milestone | State |
|---|---|
| **M0 — the floor** | Done. Authorization engine, schema + DB guarantees, Mechanism A, sessions + audit + enforcement guards. |
| **M1 — operational core** | Done, aligned to the frontend Stage-1 design. Application funnel (lead + three-phase Stage 2), enrollment + coupling D, invites, guardian verification, consent (3 blocks + § 312.7), DOB provenance + `dob.correct`, activation, guardian portal, tiered deletion + export, retention, HTTP. |
| **M2 — The Lab** | Done. Feed, posts/comments/reactions + lifecycle, feed read + filters + out-of-pod minor-read logging, moderation (SLA, lifecycle, `feed.hide_safety`, escalation), milestones + timeline, Lab HTTP. |
| **M3 — profiles, projects, public, newsletter** | Done. Project lifecycle + coupling C2, profiles + narrative moderation + neutral verification URL, media + photo-review + coupling C1, newsletter (publish gate, coupling E, blocked, redaction), subscribers + webhooks, M3 HTTP + public reads. |
| **M4 — scale + advanced compliance** | Buildable parts done: the maturation flow + 90-day backstop + `account.recover` + 16+ `self_private`; per-request RLS (Mechanism B) on the high-risk tables; the second-chapter isolation proof (no leak, multi-membership resolution verified). |

## Notable behavior change to review

- **Guardian reads of an 18+ child now persist until the edge lapses.** The age-18 bar was corrected from all-guardian-actions to guardian *writes* only, so a guardian can still *read* their 18+ child's record during the maturation window (soft landing), ending at staff-confirm or the 90-day backstop. This matches 04-state-machines / Flow D and is the maturation premise, but it loosens an M1 behavior on purpose. `packages/app/src/maturation.ts`, `packages/core/src/can.ts`.

## Blocked on external inputs (not code, will not be faked)

- **Luminent sync** — Luminent does not exist yet (external, mid-build). Boundary documented only.
- **Live deploy** — needs Fly/R2/Resend/Stripe credentials. Templates in [deploy.md](deploy.md).
- **Production data** — the legal review (open-questions L1-L5) gates real families' data reaching production. All code is tested against synthetic data only.
- **Frontend React UI** — `/apply`, profile, and public-directory pages are the frontend agent's; the backend/services/API are built.

## Deferred go-live wiring (documented, low-risk to add later)

- **Activate RLS on the app path** — the policies + `withRlsContext` helper exist and are proven via the `curiolab_rls` role; connecting the app as that role and threading the per-request GUC through every read is a broad refactor, left deliberate rather than done overnight.
- **Mailer** — Resend send is a seam throughout (invites, Stage-2 tokens, receipts, newsletter, recovery); the `resend` dep is installed, delivery needs the key + domains.
- **Job scheduling** — the sweep/escalation/scheduled-publish job bodies exist; pg-boss scheduling is a wiring step.
- **`reissueSetup` token persistence** — the recovery token is minted and audited but not yet persisted/consumable (needs an invite-kind + accept path).

## Open questions for you (small, non-blocking)

- Per-role scope tightening isn't expressible in `can` today: post `remove` and `project.verify` are gated by capability/scope, not the prose's narrower director-only / own-pod-only. A `can` extension would close these if wanted.
- `newsletter.draft` widened to senior/lead instructors + comms + director; `narrative.review` is lead + director. Confirm the role sets.

## How to run

- All tests: `npm run test --workspaces` (~1m45s). One package: `npm run test --workspace=@curiolab/db`.
- DB tests download an embedded Postgres on first run; no Docker needed.
