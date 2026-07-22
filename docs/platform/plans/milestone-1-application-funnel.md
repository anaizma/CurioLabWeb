# Milestone 1 — Application funnel: coordination plan

Status: living. Stage-1 owner (this doc): the web/frontend agent. Platform backend
(`packages/*`) owner: the backend agent.

This is the shared record so the two efforts connect cleanly. Read it before touching the
application funnel from either side.

## Why this exists

The application funnel reshapes intake into stages: Stage 1 collects only a parent email (no
child data); Stage 2 (2A parent / 2B student / 2C parent-submit) collects the rest under one
token and submits as a parent action; Stage 3 is post-acceptance consent. Design spec:
[../../superpowers/specs/2026-07-22-application-funnel-stage-1-design.md](../../superpowers/specs/2026-07-22-application-funnel-stage-1-design.md).

## Division of work

### Built now, by the web agent (Stage 1, self-contained)

To avoid colliding with the backend agent's live, uncommitted work in `packages/app` and
`packages/db`, Stage 1 is deliberately self-contained in the web app and touches no package:

- `app/apply/page.tsx` — the Stage-1 form (parent email, filler role, chapter, source).
- `app/api/apply/route.ts` — the public write; calls the lead service, sends emails.
- `lib/leads/*` — a small lead service (`createLead`, `sweepExpiredLeads`) over a `LeadStore`
  interface, with an in-memory store for dev/test and a `postgres` adapter for production.
- `db/application_lead.sql` — the `application_lead` table DDL (web-app-owned for now).
- Emails via Resend: a parent receipt (no live link yet) and a staff notification.

### The Phase-2 handoff (backend agent owns, when convenient)

When the backend agent restructures `application` for the funnel, fold Stage 1 in:

1. **Move the lead model into `packages/db`**: an `application_lead` table (columns as in
   `db/application_lead.sql`), replacing the web-app-owned copy — a Drizzle def + a migration
   (`0005_application_lead.sql` or the next free number).
2. **Move lead logic into `packages/app`**: `LeadService.createLead` / `sweepExpiredLeads`
   mirroring `lib/leads/service.ts`, gated the same inert way as the current public write.
3. **Supersede `submitApplication`**: the public write creates a *lead*, not an `application`
   row with a child's name. `application.applicant_name` / `applicant_contact_email` (currently
   NOT NULL) move off the public path; child facts arrive at 2A and the row is created at 2C.
4. **Repoint the web route** `app/api/apply/route.ts` from `lib/leads` to `@curiolab/app`.
5. **Retire** `db/application_lead.sql` and `lib/leads/*` once the above lands.

### The token / 2A–2B–2C contract (for Phase 2)

- One token per application, shared by 2A/2B/2C with a section parameter; 30-day expiry at
  request time; partial answers persist against the token; consumed at 2C submit.
- `application_lead.token_hash` issued at Stage 1 is the seed; `converted_at` is set when 2C
  creates the `application`.
- No student email is ever collected; the 2B link is delivered to the parent.

## Retention job — aligns with the backend's § 312.4(c)(1)(vii) work

`sweepExpiredLeads` deletes unconverted leads past `expires_at` (30 days) — the
§ 312.4(c)(1)(vii) delete-if-no-consent obligation.

The backend agent already implemented this obligation for the *current* model (commit
`3da1b5b`): `packages/app/src/retention.ts` defines the canonical 30-day consent-seeking window,
and `packages/app/src/retention-sweep.ts` (`sweepUnconsentedApplications`) redacts stale
`application` rows and writes an audit entry citing `16 CFR 312.4(c)(1)(vii)`. My
`sweepExpiredLeads` is the **funnel-model version of the same job**, on `application_lead`
instead of `application`.

Alignment for Phase 2:

- Source the window from `packages/app/src/retention.ts`, not a second hardcoded constant
  (`LEAD_TTL_MS` mirrors it for now).
- Consolidate `sweepUnconsentedApplications` and `sweepExpiredLeads` into one sweep once the
  funnel supersedes the single-row model — the lead becomes the thing holding "contact
  information collected to seek consent," so the sweep target moves from `application` to
  `application_lead`.
- Match their audit-entry shape (`citation: '16 CFR 312.4(c)(1)(vii)'`) when the sweep moves
  into `packages/app`.

Wire it to the platform's pg-boss worker at go-live; until then it is invokable directly.

## Go-live dependencies (not provisioned here)

- A provisioned Postgres (`DATABASE_URL`) with `db/application_lead.sql` applied.
- The transactional email subdomain with SPF/DKIM/DMARC (currently the Resend sandbox sender).
- The pg-boss schedule for `sweepExpiredLeads`.
