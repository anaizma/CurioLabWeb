# Build status

Current snapshot of the overnight build. Everything below I ran and verified myself; no claim is unrun. Branch `feat/platform-m1`, pushed to GitHub.

## Verified state

**669 tests green** across five packages: core 128, db 143, runtime 24, app 277, http 97. Full workspace run is ~1m45s on the shared-Postgres-per-package harness. Root `next typegen && tsc --noEmit` is clean across all `app/api` route handlers.

| Milestone | State |
|---|---|
| **M0 — the floor** | Done. Authorization engine, schema + DB guarantees, Mechanism A, sessions + audit + enforcement guards. |
| **M1 — operational core** | Done, aligned to the frontend Stage-1 design. Application funnel (lead + three-phase Stage 2), enrollment + coupling D, invites, guardian verification, consent (3 blocks + § 312.7), DOB provenance + `dob.correct`, activation, guardian portal, tiered deletion + export, retention, HTTP. |
| **M2 — The Lab** | Done. Feed schema, posts/comments/reactions + lifecycle, feed read + filters + out-of-pod minor-read logging, moderation (generated SLA, lifecycle, `feed.hide_safety` + auto-file, escalation job), milestones + timeline (empty-state), Lab HTTP. |
| **M3 — profiles, projects, public, newsletter** | Done. Project lifecycle + coupling C2, profiles + narrative moderation + the neutral verification URL, media + photo-review + coupling C1, newsletter (publish gate, coupling E, blocked, unpublish redaction), subscribers + double opt-in, Resend/Stripe webhooks (signature-verified, idempotent), and the M3 HTTP layer + public reads. |
| **M4 — scale + advanced compliance** | In progress: Mechanism B (RLS), the maturation flow + backstop + recovery, deletion polish, second-chapter proof. |

## Blocked on external inputs (not code, will not be faked)

- **Luminent sync** — Luminent does not exist yet (external, mid-build). Boundary documented only.
- **Live deploy** — needs Fly/R2/Resend/Stripe credentials. Templates and checklist in [deploy.md](deploy.md).
- **Production data** — the legal review (open-questions L1-L5) gates real families' data reaching production. All code is built and tested against synthetic data.
- **Frontend React UI** — the `/apply`, profile, and public-directory pages are the frontend agent's per the Stage-1 coordination design; the backend, services, and API for them are built.

## Open questions for you (small, non-blocking)

- Per-role scope tightening isn't expressible in `can` today (it picks one membership by resource scope, not per-role scope): post `remove` and `project.verify` are gated by capability/scope rather than the prose's narrower "director-only" / "own-pod-only". A `can` extension (per-role scope, or an `actorCondition`) would close these if you want them tightened.
- `newsletter.draft` was widened to senior/lead instructors + comms + director (drafting-is-wide); `narrative.review` is lead + director (no senior). Confirm the role sets.
- One controller (`PATCH /ops/newsletter/[id]` body edit) touches SQL directly because no `NewsletterService.edit` exists yet; fine to leave or fold into a service method later.

## How to run

- All tests: `npm run test --workspaces` (~1m45s). One package: `npm run test --workspace=@curiolab/db`.
- DB tests download an embedded Postgres on first run; no Docker needed.
