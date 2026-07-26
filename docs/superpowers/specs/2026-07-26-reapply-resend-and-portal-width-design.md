# Re-apply resend + Date column + director portal width

**Date:** 2026-07-26
**Status:** Approved (in-chat), pending implementation plan
**Scope:** Features A and B below. Feature C (duplicate name+DOB flag) is deferred to its own design round.

## Problem

Three asks from the director:

1. **Layout (A):** the director portal main view is narrow with dead space on the far right, and the left menu is floated inside a centered container instead of hugging the left edge. Expand the main view to use the width; pin the menu to the far-left edge at every screen size.

2. **Re-apply (B1):** a parent who loses the emailed application link cannot request another one for the same email (the second submit is silently suppressed within 24h, and after 24h it creates a duplicate lead). Allow re-applying with the same email: always send a fresh, working link, and do not pile up duplicate Interested rows.

3. **Date column (B2):** replace the "Applied" column with a "Date" column, moved to the right next to Status. It shows the effective time of the row's *current* status (for Interested: when the link was last sent; for Submitted/Screening/etc.: when that status began).

Feature C (deferred): flag a probable duplicate applicant by matching name + date of birth, surfaced in the dashboard, non-blocking, manually clearable. DOB is not collected until enrollment, so this is a later-stage feature needing its own design.

## Background (current system)

- `LeadService.createLead` (`packages/app/src/lead.ts`) dedupes on email within `LEAD_DEDUPE_WINDOW_MS` (24h): an in-window repeat returns `{ suppressed: true, parentToken: null }` and sends no email. A repeat after the window creates a brand-new lead.
- The lead's `token_hash` IS the parent's continue-link token; `startStage2` reuses it as the draft's `parent_token_hash` (`packages/app/src/stage2.ts:160`). Only the hash is stored, so the raw link cannot be re-sent — a re-send must mint a fresh token.
- `application_lead` columns: email, chapter, chapter_id, source, filler_role, status, token_hash, converted_application_id, converted_at, created_at, expires_at, deleted_at. (No last-requested timestamp yet.)
- The applications list (`OpsReadService.listApplications`) already unions open leads as `interested` items (built earlier this session). Each item currently carries `submittedAt` = created_at, shown in an "Applied" column.
- `application_event(application_id, from_status, to_status, at, ...)` records every status transition; the latest `at` for the current status is the "when this status began" time.
- Portal layout: `PortalShell` (header) and `PortalSidebar` both wrap content in `mx-auto max-w-6xl px-6`, a centered 72rem container. The director (sidebar) shell renders `[aside w-52 | gap | main flex-1]` inside that centered cap, so the sidebar floats and the content is capped narrow.

## Design

### Feature A — director portal width + far-left sidebar

Only the ops (sidebar) shell changes; the student/parent top-nav portals are untouched.

- `components/portal/PortalSidebar.tsx`: change the wrapper from `mx-auto max-w-6xl px-6 py-8` to a full-width container (`w-full px-6 py-8`). The `aside` then sits at the left edge (minus page gutter) at every screen size, and `main flex-1` expands to fill all remaining width — removing the right-side dead space. No content max-width cap (the director explicitly wants the width used; the applications table already manages its own horizontal scroll).
- `components/portal/PortalShell.tsx`: the header inner container is centered `mx-auto max-w-6xl` today. When `sidebar` is set, make it full-width (`w-full px-6`) so the brand/toggle align to the far-left above the sidebar and the avatar to the far-right, consistent with the widened content. When `nav` mode (no sidebar), keep the centered `max-w-6xl` (student/parent unchanged).

### Feature B1 — re-apply resend (reuse the open lead, else new)

Change `LeadService.createLead` so a repeat email is a first-class "resend", not a suppression:

- Look up the most recent **open** lead for the email: `converted_application_id IS NULL AND deleted_at IS NULL` (any age — the 24h window no longer gates this). If found:
  - Mint a fresh Stage-2 token; update the lead's `token_hash = newHash`, `expires_at = now + LEAD_EXPIRY_WINDOW_MS`, `last_requested_at = now()`. If an `application_draft` exists for that lead, also update its `parent_token_hash = newHash` so the fresh link reaches the in-progress draft (answers preserved) and the old link goes stale.
  - Return `{ leadId, suppressed: false, parentToken: fillerRole === 'parent' ? newRaw : null, resent: true }`. For a student-filler, re-send the backend Stage-2 link email with the fresh link (same as the new-lead path).
  - The existing row is reused — no duplicate Interested row (handles the lost-link case).
- If **no** open lead exists (all prior leads converted or deleted): create a new lead as today, stamping `last_requested_at = now()`, `resent: false`. This is the "second child / re-apply after finishing" case — a new Interested row is correct.
- `CreateLeadResult` gains `resent: boolean`. The `suppressed` field remains in the type (always `false` now from this path) to avoid a breaking change to callers; it is effectively retired.

Notes:
- Rate limiting / anti-spam on rapid re-requests is an HTTP-layer concern (per `config.ts`), out of scope here — a re-submit always resends.
- `/api/apply` route: thread `resent` into the JSON response. Fire the director notification only for a genuinely new lead (`!resent`), not on a resend (the director already knows this lead; the resend just refreshes its Date).
- `/apply` page: replace the old "we already have a recent application started" suppressed branch. On `resent`, tell the parent the link was re-sent (with the continue button for a parent-filler, or "we re-sent it to your parent" for a student-filler). A new lead keeps the current copy.

### Feature B2 — "Date" column (effective time of current status)

- Migration `0041_application_lead_last_requested.sql`: add `last_requested_at timestamptz`; backfill existing rows to `created_at`; then `SET DEFAULT now()` and `SET NOT NULL`. Mirror the column in the drizzle schema (`applicationLead` in `packages/db/src/schema.ts`).
- `OpsReadService.listApplications`: add a `statusDate` (ISO string) to each `ApplicationListItem`:
  - Lead (interested) rows: `statusDate = last_requested_at`.
  - Application rows: `statusDate` = the latest `application_event.at` where `to_status = application.status` (a lateral subquery), falling back to `created_at` when there is no event. `submittedAt` stays as-is for sorting.
- Data layer (`lib/portal/director/applications-data.ts`): carry `statusDate` through `LiveListItem` → `ApplicationRow` as a formatted `statusDateLabel`.
- Page (`app/portal/director/applications/page.tsx`): remove the "Applied" column (2nd position); add a "Date" column immediately left of "Status". New column order + template: Name · School · Email · Parent · **Date** · Status. The Date cell shows `statusDateLabel`; the "all terms" term hint moves under the Date cell.

## Non-goals / YAGNI

- No true anti-spam/rate-limit on re-requests (HTTP-layer concern).
- No change to the token model beyond re-minting the parent token on resend (student/review tokens are separate, re-triggered by their own actions).
- Feature C (name+DOB duplicate flag) is explicitly out of scope for this round.
- Content max-width is intentionally removed for the ops shell; not adding a new cap.

## Testing

- **Lead (B1):** `packages/app/test/lead.test.ts` — a repeat email on an open lead resends (new token hash, `resent: true`, `last_requested_at` advanced, same lead id, no new row); a repeat when the only prior lead is converted creates a new lead; a draft's `parent_token_hash` is updated so the fresh token resolves the draft and the old token no longer does. Update the existing in-window-suppression test to the new resend behavior.
- **Date (B2):** `packages/http/test/ops-read.test.ts` — an interested lead's `statusDate` equals its `last_requested_at`; an application's `statusDate` reflects its latest status-change event (e.g. after a screen transition), and falls back to created_at with no events.
- **Layout (A) / apply route + page:** verified by running the app (RSC pages, no unit harness). Existing `test/apply-funnel-flow.test.ts`, `test/director-nav.test.ts`, `test/portal-visibility.test.ts` must stay green.

## Coordination note

Backend edits touch `packages/app/src/lead.ts`, `packages/app/src/ops-read.ts`, `packages/db/*` — territory a second agent has worked on this branch. Confirm those files are quiet before editing; the frontend/layout parts are independent.
