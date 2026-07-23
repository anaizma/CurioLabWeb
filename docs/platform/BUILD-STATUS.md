# Build status

Current snapshot of the overnight build. Everything below I ran and verified myself; no claim is unrun. Branch `feat/platform-m1`, pushed to GitHub.

## Verified state

**504 tests green** across five packages: core 120, db 98, runtime 24, app 208, http 54. Full workspace run is ~1m44s (a shared embedded Postgres per package; the old per-file harness that took 6m44s and collided on a fixed port is gone).

| Milestone | State |
|---|---|
| **M0 — the floor** | Done. Authorization engine, schema + DB guarantees, Mechanism A, sessions + audit + enforcement guards. |
| **M1 — operational core** | Done and aligned to the frontend Stage-1 design. Application funnel (lead + three-phase Stage 2), enrollment + coupling D, invites, guardian verification, consent capture (3 blocks + § 312.7), DOB provenance + `dob.correct`, student activation, guardian portal, tiered deletion + export fulfillment, retention sweep, HTTP layer. |
| **M2 — The Lab** | Done. Feed schema, post/comment/reaction services with the hide/remove lifecycle, feed read + filters with out-of-pod minor-read logging, moderation (generated SLA, lifecycle, `feed.hide_safety` + auto-file, escalation job), system-generated milestones + timeline (empty-state), and the Lab HTTP layer. |
| **M3 — profiles, projects, public, newsletter** | In progress (started tonight). |
| **M4 — scale + advanced compliance** | Buildable parts pending (RLS, maturation flow, second-chapter proof). |

## Blocked on external inputs (not code, will not be faked)

- **Luminent sync** — Luminent does not exist yet (external system, mid-build). Documented boundary only.
- **Live deploy** — needs Fly/R2/Resend/Stripe credentials. Templates and checklist are in [deploy.md](deploy.md).
- **Production data** — the legal review (open-questions L1-L5) gates real families' data reaching production. All code is built and tested against synthetic data.
- **Frontend React UI** — the `/apply` page, profile pages, and public directory pages are the frontend agent's per the Stage-1 coordination design. The backend, services, and API for them are mine and are being built.

## Open questions for you (small, non-blocking)

- Post `remove`: gated on `feed.moderate` (any teaching role) vs the state machine's `chapter_director` actor. One-line `actorCondition` if you want director-only.

## How to run

- All tests: `npm run test --workspaces` (~1m44s).
- One package: `npm run test --workspace=@curiolab/db` (or app/core/http/runtime).
- DB tests download an embedded Postgres on first run; no Docker needed.
