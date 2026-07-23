# Milestone 1 application funnel (v3 — aligned to the Stage-1 design)

**Authority:** [`docs/superpowers/specs/2026-07-22-application-funnel-stage-1-design.md`](../../superpowers/specs/2026-07-22-application-funnel-stage-1-design.md)
is the approved design and the single source of truth for the `application_lead`
schema (§7.1), the lead service (§7.2), and the Phase-2 contract (§8). This plan
records how the backend build in `packages/*` matches it. Where this plan and the
design ever disagree, the design wins.

This supersedes v2. v2 modeled Stage 1 as an `email`/`chapter`/`referral` lead
with a `status`-driven retention sweep and a staff-gated Stage 2 start. The
approved design refines the shape and the wiring; the changes are recorded below.

## The COPPA logic that shapes it

The application stage collects no personal information from a child and requires
no VPC, because of two structural facts: the student section (2B) collects nothing
identifying, and only the parent submits (at 2C). That makes the whole thing a
parent submission on the minor's behalf, not collection from a child. Both facts
are enforced in code, not left to good intentions. Stage 1 is outside COPPA's
minor-data surface entirely (a parent email, no child data), so it may run live
during the paper period; Stage 2+ are built and tested against synthetic data now.

## Stage 1: lead capture (public, no gate, no child data)

`application_lead` is the public write. It carries a parent email, a chapter CODE,
an optional "how did you hear" source, and who filled the form. Nothing about a
child.

`application_lead` columns (design §7.1; migration `0012_application_lead_stage1.sql`,
an additive ALTER over the `0010` base table):

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `email` | citext NOT NULL | parent/guardian email |
| `chapter` | text NOT NULL | selected chapter **CODE** (not an fk) — so "interested in another school", which has no chapter row, is expressible |
| `chapter_id` | uuid NULL → chapter | kept as the optional 2C linkage, populated when the code maps to a real chapter (by slug) |
| `source` | text NULL | "how did you hear" — optional |
| `filler_role` | enum(`parent`,`student`) NOT NULL | who filled Stage 1; drives the confirmation copy |
| `token_hash` | text NULL | the Stage-2 token, **issued at lead creation** (forward-compat); consumed by Stage 2 |
| `status` | enum NOT NULL | backend lifecycle (`new`/`stage2_started`/`converted`/`deleted`); kept from 0010 |
| `converted_application_id` | uuid NULL → application | backend linkage, set at 2C submit |
| `converted_at` | timestamptz NULL | the design's conversion marker, set at 2C submit |
| `created_at` | timestamptz NOT NULL | |
| `expires_at` | timestamptz NOT NULL | `created_at + 30 days` — the retention/deletion floor, read at request time |

The public write creates one `application_lead` in `new`. No account, no child
data. Rate limiting and the bot check are HTTP-layer concerns. Dedupe on `email`
within a configurable window.

Because it holds only a parent email collected to seek consent, an unconverted
lead is deleted 30 days after collection (the § 312.4(c)(1)(vii) job). "Unconverted"
means `converted_at IS NULL`; "past the floor" means `expires_at < now`.

## Stage 2: three phases against two tokens

A Stage 2 process is one `application_draft` bound to the lead, holding partial
answers that persist throughout. The **parent** token originates from the lead's
`token_hash` (issued at `createLead`); the draft advances through three phases.
A **separate student token** gates 2B — the two-token model is retained
deliberately: a single shared token would let the student's 2B link open the
parent's 2A/2C sections.

### 2A: the parent section
The parent fills the parent-provided facts about the child (name, grade, school)
and guardian details. Saved against the parent token. Identifying child facts here
are fine: the parent is providing them.

### 2B: the student section
The student answers their own section. **2B collects no identifying fields at all**
(enforced by an allowlist, so an identifying field cannot be saved even if the form
is tampered with). **A student email is never collected anywhere.** 2B **saves and
notifies the parent; it does not submit.**

### 2C: parent review and submit
The parent reviews the student's 2B answers **read-only**, with a **send-back**
option that returns the draft to 2B. The parent cannot edit the student's answers.
**Only the parent can submit, and only at 2C.** Submit creates the `application`
row (from the 2A parent section and the 2B student section) and sets the lead's
`converted_at` + `converted_application_id`.

## Invariants to check the implementation against

1. Stage 1 collects only parent email, chapter code, optional source, and filler_role. It creates an `application_lead`, never an `application`.
2. Stage 2 is three phases (2A parent, 2B student, 2C parent review-and-submit) against one draft, with partial answers persisting throughout.
3. 2B collects no identifying fields (enforced by allowlist); no student email is ever collected.
4. 2B saves and notifies; it does not submit. Only 2C submits, and only the parent — a student token cannot resolve a parent-gated op.
5. The parent sees 2B read-only at 2C, with send-back, no editing.
6. The `application` row is created at 2C submit, not before; 2C sets the lead's `converted_at`.
7. Unconverted leads (`converted_at IS NULL`) delete once past `expires_at` (created_at + 30 days).

## What this changed in the built code (the v2 → design rework)

1. **`application_lead` reshaped** (`packages/db`, migration `0012`, additive ALTER):
   `referral_source` → nullable `source`; add `chapter` text CODE (chapter_id kept as
   the optional fk linkage); add `filler_role`, `expires_at`, `converted_at`. Drizzle
   `schema.ts`/`enums.ts` updated to match.
2. **`LeadService.submitLead` → `createLead(input)`** (`packages/app`): `input` is
   `{ email, chapter, source?, fillerRole }`. Dedupes on email in-window; issues the
   hashed `token_hash`; resolves the optional `chapter_id` when the code matches a
   chapter slug; stamps `expires_at = created_at + 30d`; inserts; returns
   `{ leadId, suppressed }`. Unauthenticated and inert.
3. **`sweepUnconvertedLeads` → `sweepExpiredLeads(deps, now?)`**: deletes leads where
   `converted_at IS NULL AND expires_at < now` (and their drafts); returns the deleted
   count/ids; writes the same PII-free `retention.contact_deleted` audit by reference.
4. **Stage 2 token origin**: `startStage2` no longer mints a fresh parent token — it
   **validates/consumes the lead's `token_hash`** and creates the draft (binding that
   same hash as the draft's `parent_token_hash`). It is now token-gated
   (unauthenticated), not staff-gated: the parent proceeds from the token in their
   inbox. 2C submit sets the lead's `converted_at` + `converted_application_id`.
5. **Route ownership**: the Stage 1 `POST /api/apply` route and its lead-write HTTP
   controller belong to the web/frontend (design §7.3) and were removed from the
   backend (`packages/http`). The Stage 2 endpoints move under `/api/public/stage2/*`
   (start is now token-gated public, replacing the old staff `/api/ops/leads/:id/
   start-stage2`). Their controllers are kept.

## Phase 2 contract (design §8, recorded for the other agent)

- The `application_lead` row is the anchor. Its `email` is the guardian invite floor;
  its `token_hash` gates Stage 2; `converted_at` is set when 2C creates the `application`.
- `application` becomes funnel-shaped: `applicant_name` / `applicant_contact_email`
  move off the public write (currently `NOT NULL`), child facts arrive at 2A, the
  student section (2B) is stored against the token, and the row is created in
  `submitted` only at 2C submit.
- Two tokens (parent + student) per draft; 30-day expiry evaluated at request time;
  partial answers persist; the parent token is consumed to start and to submit.

## Live-during-paper-period note

Stage 1 lead capture is the only part of the funnel that may run live during the
paper period, because it collects only a parent email. Stage 2 and everything
downstream are built and tested against synthetic data now and go live only when
the legal review in [../open-questions.md](../open-questions.md) clears. The
transactional-email subdomain and the pg-boss retention worker are recorded go-live
dependencies, not provisioned here.
