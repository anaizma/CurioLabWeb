# Apply-click notification + Interested leads

**Date:** 2026-07-26
**Status:** Approved, pending implementation plan

## Problem

When someone clicks **Apply** on `/apply` (filling in email, chapter, and who is
filling it out), a lead is captured but the director has no signal. If that person
never finishes the multi-step application, they are effectively lost — the director
never learns they were interested. We want two things:

1. An automated email to the director's inbox on every fresh Apply click, so no
   interested person is missed even if they never complete the funnel.
2. Those same not-yet-finished people surfaced in the director portal's Applications
   list under a new **Interested** status, updating live.

Alongside this, the Applications list is simplified: the Partial/Full view toggle is
removed (full view becomes the only view), and every status gets its own color.

## Background (current system)

- `/apply` posts to `/api/apply` (frontend-owned). On a fresh submission this creates
  one `application_lead` row (status `new`) and emails the Stage-2 continue link.
  In-window duplicates are suppressed (no new row, `suppressed: true`).
- `application_lead` columns of interest: `email`, `chapter` (code), `chapter_id`
  (nullable fk — null for "interested in another school"), `source`, `filler_role`
  (`parent`|`student`), `converted_application_id` (fk, set when the funnel completes),
  `converted_at`, `created_at`, `expires_at` (created_at + 30d), `deleted_at`.
- The director Applications page reads `/api/ops/applications`, served by
  `OpsReadService.listApplications` (`packages/app/src/ops-read.ts`), which today lists
  ONLY rows from the `application` table (real submitted applications), term-filtered by
  `created_at` containment. It has a Partial/Full view toggle and per-view column sets.
- Statuses today: `submitted · screening · interview · accepted · declined`, all rendered
  with one shared accent color.

**Key insight:** a lead that has not converted is exactly
`converted_application_id IS NULL`. Once the funnel completes, the lead converts and the
person appears as a real `application` row with its real status — so an Interested lead
and a submitted application are mutually exclusive. No double-listing.

## Design

### 1. Director notification email (frontend)

In `app/api/apply/route.ts`, after a fresh lead is created (`result.suppressed === false`),
send a best-effort notification email to the director. Wrapped in try/catch, logged on
failure, never blocks the response or rolls back the lead — mirroring the existing
continue-link send.

- **Recipient:** `process.env.DIRECTOR_NOTIFY_EMAIL ?? "esong@acuriolab.org"`.
- **Trigger:** every fresh (non-suppressed) lead, covering both parent- and
  student-filler paths, since `/api/apply` observes every submission. Suppressed
  in-window duplicates send nothing (no inbox spam).
- **Guard:** only when `RESEND_API_KEY` is set (same as the existing send).
- **Content:** subject like `New CurioLab lead: <email>`; body states the email, chapter
  code, filler role (parent/student), and source ("how did you hear", or a dash), plus a
  link to `/portal/director/applications`.
- **New helper:** `sendDirectorLeadNotification(...)` in `lib/emails/apply-mail.ts`.

### 2. Interested leads in the applications list (backend)

Extend `OpsReadService.listApplications` (`packages/app/src/ops-read.ts`) to include open
leads as synthetic rows.

- **Selected leads:** `converted_application_id IS NULL AND deleted_at IS NULL AND
  expires_at > now()`, scoped to the director's resolved chapters via
  `chapter_id IN (<chapters>)`. Leads with a null `chapter_id` ("another school") are NOT
  in any chapter's list; the director still receives the email for them, so they are not
  missed.
- **Row mapping** (a lead becomes an `ApplicationListItem`):
  - `applicationId`: a lead-marked id (e.g. prefixed) so the frontend can tell it is a lead.
  - `status`: `"interested"`.
  - `studentName`: `null` (no student identity yet).
  - `submittedAt`: `lead.created_at` (the "Applied" date = when they clicked Apply).
  - `contactEmail`: `lead.email`.
  - New field `fillerRole: "parent" | "student"` and marker `isLead: true`.
  - grade / school / guardian: null → rendered as dashes.
- **Term filter:** leads have no term. Because the goal is "don't miss anyone," open leads
  are ALWAYS included regardless of the selected term, sorted by `created_at` alongside
  applications (so recent leads land near the top). A specific-term selection still filters
  applications by term but does not hide leads.
- **Status filter:** `"interested"` is not a DB enum value on `application.status`. When a
  `status` filter is present and does NOT include `interested`, leads are excluded; when it
  includes `interested` or no status filter is given, leads are included.
- **PII:** lead email is already director-visible in full view; leads only expose email +
  filler role + created date, which is less than an application row.

### 3. Frontend: remove Partial view, per-status colors

In `app/portal/director/applications/page.tsx` and
`components/portal/director/ApplicationsControls.tsx`:

- Remove the Partial/Full toggle, the `view` query param, the `full` badge, and the
  `COLS_PARTIAL` template. The page is ALWAYS full view. The controls keep only the term
  dropdown.
- `ApplicationStatus` gains `"interested"`. Each status renders with its own color badge
  (soft background + readable foreground):

  | status | color |
  |---|---|
  | interested | gray (neutral) |
  | submitted | blue |
  | screening | amber |
  | interview | purple |
  | accepted | green |
  | declined | rose |

- Interested rows show **the email plus a small `Parent`/`Student` tag** in the Name
  column and are NOT clickable (no lead-detail page exists). Real application rows remain
  links to their detail page.
- `applications-data.ts`: `getApplicationsView` always requests `?view=full`; `mapAppStatus`
  passes through `"interested"`; the `ApplicationRow` type carries `fillerRole` and `isLead`.

### 4. Real-time updates (polling ~20s)

A small client component `<AutoRefresh intervalMs={20000} />` mounted on the Applications
page calls `useRouter().refresh()` on an interval, re-running the existing server-side
fetch. New leads and status changes appear within ~20 seconds. No new backend
infrastructure.

## Non-goals / YAGNI

- No true push (websockets/SSE) — polling is sufficient for a review screen.
- No lead-detail page — Interested rows are informational only for now.
- No batching/"leads that never finish" detection — the email fires immediately on every
  fresh click, which already guarantees nothing is missed.
- No change to "another school" (null-chapter) leads in the list; the email covers them.

## Testing

- **Backend** (`packages/app` ops-read tests): an open lead appears as `interested`;
  a converted / expired / soft-deleted lead does NOT; chapter scoping holds; the status
  filter includes/excludes leads correctly; leads appear regardless of term filter.
- **Email:** `sendDirectorLeadNotification` covered with a FakeMailer (recipient default +
  env override, content includes email/chapter/filler role).
- **Frontend:** verified by running the app — Partial toggle gone, Interested rows show
  email + tag and are non-clickable, per-status colors render, list auto-refreshes.

## Coordination note

Section 2 edits `packages/app/src/ops-read.ts`, backend territory a second agent has
worked on this branch (`feat/platform-m1`). Before editing that file, confirm it is quiet;
if active, pause section 2 and coordinate rather than collide. Sections 1, 3, and 4 are
independent frontend/email changes and safe regardless.
