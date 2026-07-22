# Application funnel — Stage 1 design

Date: 2026-07-22
Status: approved design, pre-implementation
Owner: web/frontend agent (esong)
Related: [the funnel spec] (in-conversation), `docs/platform/*`, `packages/app`, `packages/db`

## 1. Problem

Today a student cannot apply through the site. The two "apply" calls to action both
dead-end: the homepage "Start an application" links to `/students`, whose only action
is a `mailto:aizma@curiolab.org` link ([app/students/page.tsx:20](../../../app/students/page.tsx#L20)).
The `/signup` form submits nowhere and says the backend is not live. There is no route,
no form, and no record of interest.

Separately, a platform build is underway in `packages/*` and `docs/platform/*`. Its
current application model — `ApplicationService.submitApplication`
([packages/app/src/service.ts:98](../../../packages/app/src/service.ts#L98)) — collects a
**child's** name and contact email at the public, unauthenticated write and stores them
in a single `application` row. The new funnel spec supersedes that model.

## 2. The funnel spec, in one paragraph

Applications become a staged funnel. **Stage 1** (website) collects only a parent/guardian
email, a chapter, and an optional "how did you hear" — nothing about a child. **Stage 2**
(in the parent's inbox) is where child facts, the guardian section (2A), the student's own
voice (2B), and parent review-and-submit (2C) happen, all under one token; nothing submits
until the parent submits at 2C. **Stage 3** (after acceptance only) is the signed COPPA
consent form and the deferred sensitive fields. The legal rule that makes this work:
a parent providing information about their own child is not "collection from a child," so
no verifiable parental consent is required at the application stage — what decides it is who
clicks submit, and that is always the parent at 2C.

## 3. The legal-gate reframing (a decision recorded here)

The platform docs currently read as if the COPPA legal review blocks *the build*. The ruling
that governs this work:

> **The legal review gates real families' data reaching production, not the code. All of
> Milestone 1 is buildable and testable now against synthetic data.**

Consequences:

- **Stage 1 has no gate at all.** It collects a parent email and nothing about a child, so
  it is outside COPPA's minor-data surface entirely — the same category as the public site,
  which [08-build-phasing.md](../../platform/08-build-phasing.md) already ships early. Stage 1
  can go live during the fall-2026 paper period.
- **Stages 2–3 are buildable and testable now** against synthetic data (the embedded-Postgres
  test harness), but must not collect a **real** family's data in production until the legal
  review clears the items in [open-questions.md](../../platform/open-questions.md) L1–L5.

Stage 1 also *is* a compliance artifact, not just interest capture: the unconverted-lead
deletion implements the § 312.4(c)(1)(vii) "delete the contact information collected to seek
consent if consent is not obtained within a reasonable window" job that
[compliance-coppa.md:91](../../platform/compliance-coppa.md#L91) mandates.

## 4. Scope

### In scope (Phase 1 — build now, fully)

1. **Doc reconciliation** (done first, before code): update `08-build-phasing.md` and
   `open-questions.md` to reflect the build-vs-production reframing and the COPPA findings.
2. **Coordination plan**: create `docs/platform/plans/milestone-1-application-funnel.md` — the
   shared artifact recording this build and the Phase-2 handoff surface for the other agent.
3. **Data**: a new `application_lead` table via an additive migration in `packages/db`.
4. **Service**: `LeadService.createLead` + `sweepExpiredLeads` in `packages/app`; **rework the
   public write** so `submitApplication`'s child-data collection is superseded by lead creation.
5. **Web**: an `/apply` page (Stage-1 form) + `POST /api/apply` route, Resend parent-receipt and
   staff-notification emails, and rewiring the existing "apply" CTAs to `/apply`.
6. **Retention job**: the 30-day unconverted-lead deletion.

### Designed and recorded, not built (Phase 2)

Stage 2A/2B/2C: the tokenized parent + student sections, partial-save, and the construction of
the `application` row at 2C. Restructuring the `application` table (its `applicant_name` /
`applicant_contact_email` are currently `NOT NULL`, which the funnel defers). Recorded in the
coordination plan with a data/service contract so the other agent can align or own it.

### Out of scope (Phase 3+)

The Stage-3 COPPA consent form and deferred sensitive fields; the ops review queue rework;
anything touching a real family's data in production.

## 5. Coordination model (the "two dots")

The other agent is **actively** building `packages/db` and `packages/app` right now (migrations
`0003`/`0004` were written today, closing the consent-linkage gap from
[BUILD-STATUS.md:40](../../platform/BUILD-STATUS.md#L40)). There is **no recorded Milestone-1
plan** — only [milestone-0.md](../../platform/plans/milestone-0.md). So coordination is
established here, not inherited:

- **A recorded plan.** `docs/platform/plans/milestone-1-application-funnel.md` states exactly
  what this build adds/changes in `packages/db` and `packages/app`, and what is deliberately
  left to the backend agent. It is the document the other agent reads to connect the two efforts.
- **Worktree isolation.** All `packages/*` edits happen in a **git worktree**, not in the live
  working tree where the other agent may be writing the same files. Frontend-only files
  (`app/apply/**`, CTA edits) are unambiguously this agent's and carry no collision risk.
- **Additive-first.** New files where possible: `0005_application_lead.sql`, a new
  `lead-service.ts`. The one rework — the public write superseding child-data collection — is
  called out explicitly in the plan so it is a coordinated change, not a surprise.

## 6. Doc reconciliation — specific edits

**`08-build-phasing.md`**
- In the Milestone-1 section and its "Hard gate" line, add the build-vs-production distinction:
  Milestone 1 is buildable and testable now against synthetic data; the legal review gates
  real-family data reaching production, not the code.
- Note the funnel supersession: the public write creates an `application_lead` (parent email
  only), not a child-data `application` row.
- Point blanket retention language at the tiered schedule in
  [compliance-coppa.md:1.5](../../platform/compliance-coppa.md#L27).

**`open-questions.md`**
- Add the build-vs-production note to the legal-gate framing at the top.
- Under "Resolved by the COPPA analysis", record two build items: (a) the funnel supersedes the
  single-row application model; (b) the § 312.4(c)(1)(vii) 30-day delete-if-no-consent job is
  implemented by `application_lead.expires_at`.

These edits do not change any legal conclusion; they align the docs with the ruling in §3 and
with the funnel supersession.

## 7. Phase 1 technical design

### 7.1 Data — `application_lead` (packages/db, migration `0005_application_lead.sql`)

A new table, additive; touches no existing table.

| column | type | notes |
|---|---|---|
| `id` | uuid pk | `defaultRandom()` |
| `email` | citext, not null | parent/guardian email; the future invite floor |
| `chapter` | text, not null | selected chapter code (not free text) |
| `source` | text, null | "how did you hear"; optional |
| `filler_role` | enum(`parent`,`student`), not null | who filled Stage 1; drives confirmation copy only |
| `token_hash` | text, null | hashed Stage-2 token; issued now, consumed in Phase 2 |
| `created_at` | timestamptz, not null | `defaultNow()` |
| `expires_at` | timestamptz, not null | `created_at + 30 days`; the retention/deletion floor |
| `converted_at` | timestamptz, null | set when a Phase-2 application is submitted |

Notes: `citext` matches the existing `application.guardian_email` treatment. No child data,
so no DOB trigger, no consent linkage, no minor-data obligations apply. The token is issued now
for forward-compatibility even though nothing consumes it until Phase 2 (a lead with no Stage-2
destination yet emails a receipt, not a link — see §7.3).

### 7.2 Service — packages/app

- **`LeadService.createLead(input)`** — dedup on `email` within the configured window (reuse the
  `dedupeWindowMs` config idiom already in `config.ts`); on a fresh lead, issue a hashed token,
  set `expires_at = now + 30d`, insert, and return `{ leadId, suppressed }`. Unauthenticated and
  inert, exactly like the existing public write — it creates only a row that carries no authority.
- **`LeadService.sweepExpiredLeads(now)`** — deletes unconverted leads past `expires_at`
  (`converted_at is null and expires_at < now`). Returns the deleted count. This is the
  § 312.4(c)(1)(vii) job.
- **Public-write rework** — `submitApplication`'s public, child-data-collecting path is
  superseded. Its behavior and its test suite ([submit.test.ts](../../../packages/app/test/submit.test.ts))
  are rewritten to the lead model (RED→GREEN→REFACTOR, matching the repo's test-first culture and
  the [milestone-0 plan](../../platform/plans/milestone-0.md) discipline). The ops-transition
  methods (`screen`, `accept`, `decline`, `reopen`, …) are untouched — they operate on `application`
  rows that Phase 2 will create.

### 7.3 Web app — `/apply`

- **`app/apply/page.tsx`** — a client component with four fields:
  1. Parent or guardian email (required)
  2. Who is filling this out — parent / student (required; changes confirmation copy only)
  3. Chapter — a **select**: `Case Western Reserve University` plus `Interested in another
     school` (the site's live chapter is CWRU; others are prospective per
     [support/page.tsx:117](../../../app/support/page.tsx#L117))
  4. How did you hear about CurioLab (optional)
- **`app/api/apply/route.ts`** — a `POST` handler following the existing
  [contact route](../../../app/api/contact/route.ts) pattern: validate, call `LeadService.createLead`,
  then send two Resend emails — a **parent receipt** and a **staff notification** — and return
  `{ success: true }`. Rate-limit / bot-check are noted as HTTP-layer concerns (same stance as the
  service's existing comment); a basic honeypot + per-request guard is acceptable for Phase 1.
- **Confirmation copy** (client, after success), per the funnel spec:
  - parent: "Check your email — we've sent you a confirmation. A Chapter Director will be in touch."
  - student: "We've emailed your parent. Ask them to look for a message from CurioLab, and to
    check the spam folder."
- **Emails** — because Stage 2 is not built, the parent email is a **receipt**, not a live
  application link (no dead link). Staff notification carries the lead's email, chapter, and source
  so a Chapter Director can follow up through the paper-period manual process. Sender/recipient
  reuse the contact route's current Resend setup (`onboarding@resend.dev` sandbox until the
  transactional subdomain is provisioned — recorded as a go-live dependency).
- **CTA rewiring** — the homepage "Start an application" ([app/page.tsx:208](../../../app/page.tsx#L208))
  and the students-page mailto CTA ([app/students/page.tsx:20](../../../app/students/page.tsx#L20))
  point to `/apply`.
- Per [AGENTS.md](../../../AGENTS.md), read `node_modules/next/dist/docs/` before writing any
  Next.js code (this repo pins `next@16.2.10`; APIs may differ from training data).

### 7.4 The retention job invocation

The web app has no always-on worker. Phase 1 implements the deletion **query** in `LeadService`
and wires a minimal invocation — a protected/cron-triggered route — with the production wiring
(the platform's planned pg-boss worker) recorded in the coordination plan as a go-live step.

## 8. Phase 2 contract (recorded, for the other agent)

So Phase 2 slots in without redesign:

- The `application_lead` row is the anchor. Its `email` is the guardian invite floor; its
  `token_hash` gates 2A/2B/2C; `converted_at` is set when 2C creates the `application`.
- `application` needs to become funnel-shaped: `applicant_name` / `applicant_contact_email` move
  off the public write (currently `NOT NULL`), child facts arrive at 2A, the student section (2B)
  is stored against the token, and the row is created in `submitted` only at 2C submit.
- One token per application, shared by 2A/2B/2C with a section parameter; 30-day expiry evaluated
  at request time; partial answers persist against the token; consumed at 2C.

## 9. Testing

- Service + data: the existing embedded-Postgres harness
  ([packages/app/test/helpers/pg.ts](../../../packages/app/test/helpers/pg.ts)), synthetic data,
  test-first. Cases: fresh lead creates exactly one row and no account/edge; dedup within window;
  distinct emails not suppressed; resubmission outside the window not suppressed; token issued and
  hashed; `expires_at` set to +30d; `sweepExpiredLeads` deletes only unconverted expired leads and
  leaves converted/live ones.
- Web: the `/api/apply` route validates and returns the right shape on missing fields and success;
  confirmation copy branches on filler role. Follow whatever test convention the app layer uses
  (verify before adding a runner).

## 10. Non-goals / explicit non-decisions

- No Stage-2 or Stage-3 UI or data collection is built.
- No real-family data enters production through any of this until the legal review clears.
- No change to the authorization core, the consent model, or the other agent's committed M0 work.
- The transactional email subdomain (SPF/DKIM/DMARC) and the pg-boss retention worker are go-live
  dependencies, documented, not provisioned here.

## 11. Risks

- **Concurrent edits** to `packages/db` / `packages/app` by the other agent. Mitigated by worktree
  isolation, additive-first files, and the recorded plan.
- **Email deliverability** from the Resend sandbox sender is weak; acceptable for Phase 1 interest
  capture, flagged as a go-live dependency.
- **Phase-1/Phase-2 seam drift** if the other agent restructures `application` differently than §8
  assumes. Mitigated by recording the contract now and keeping Phase 1's coupling to a single link
  (`converted_at`).
