# Interested Leads + Apply Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email the director on every fresh Apply click, and surface not-yet-converted leads as a new live "Interested" status in the director Applications list, with the Partial/Full view toggle removed and every status given its own color.

**Architecture:** Three independent seams. (1) A frontend email helper + a best-effort send in `/api/apply`. (2) A backend change to `OpsReadService.listApplications` that unions open `application_lead` rows in as synthetic `interested` items. (3) Frontend list changes: always-full columns, per-status color badges, non-clickable Interested rows showing email + parent/student tag, and a 20s auto-refresh client component.

**Tech Stack:** Next.js (App Router, RSC), TypeScript, `postgres` (raw SQL tagged templates), Vitest with embedded Postgres, Resend for email.

**Key invariant:** an Interested lead is exactly `converted_application_id IS NULL AND deleted_at IS NULL AND expires_at > now()`. Once the funnel completes the lead converts and the person appears as a real `application` row — the two are mutually exclusive, so no double-listing.

---

### Task 1: Director notification email helper

**Files:**
- Modify: `lib/emails/apply-mail.ts`
- Test: `test/apply-mail.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `test/apply-mail.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { buildDirectorLeadNotification } from '../lib/emails/apply-mail'

describe('buildDirectorLeadNotification', () => {
  test('includes the lead email, chapter, filler role, source, and a portal link', () => {
    const email = buildDirectorLeadNotification({
      leadEmail: 'parent@example.test',
      chapter: 'cwru',
      fillerRole: 'parent',
      source: 'A friend told me',
      appUrl: 'https://curiolab.test',
    })
    expect(email.subject).toContain('parent@example.test')
    for (const body of [email.text, email.html]) {
      expect(body).toContain('parent@example.test')
      expect(body).toContain('cwru')
      expect(body).toContain('parent')
      expect(body).toContain('A friend told me')
      expect(body).toContain('https://curiolab.test/portal/director/applications')
    }
  })

  test('renders a dash for a missing source and never uses an em dash', () => {
    const email = buildDirectorLeadNotification({
      leadEmail: 'p@example.test',
      chapter: 'another-school',
      fillerRole: 'student',
      source: null,
      appUrl: 'https://curiolab.test',
    })
    expect(email.text).toContain('student')
    expect(`${email.subject}${email.text}${email.html}`).not.toContain('—') // no em dash (Emily's preference)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:web -- test/apply-mail.test.ts`
Expected: FAIL — `buildDirectorLeadNotification` is not exported.

- [ ] **Step 3: Add the builder and sender**

In `lib/emails/apply-mail.ts`, add below `buildParentContinueEmail` (reuse the existing `BuiltEmail` interface, `FROM`, and `Resend` import). Note: copy avoids em dashes per Emily's preference — use "-" or plain wording.

```ts
export interface DirectorLeadNotificationInput {
  /** The parent/guardian email captured on the Apply form. */
  leadEmail: string;
  /** The selected chapter CODE (may be "another-school"). */
  chapter: string;
  /** Who filled Stage 1. */
  fillerRole: "parent" | "student";
  /** "How did you hear" (optional). */
  source: string | null;
  /** Site origin used to build the applications-page link. */
  appUrl: string;
}

/** The internal "someone applied" alert sent to the director on every fresh lead. */
export function buildDirectorLeadNotification(input: DirectorLeadNotificationInput): BuiltEmail {
  const applicationsUrl = `${input.appUrl}/portal/director/applications`;
  const source = input.source && input.source.trim() ? input.source.trim() : "-";
  const subject = `New CurioLab lead: ${input.leadEmail}`;
  const text = [
    "Someone just started an application on CurioLab.",
    "",
    `Email: ${input.leadEmail}`,
    `Chapter: ${input.chapter}`,
    `Started by: ${input.fillerRole}`,
    `How did you hear: ${source}`,
    "",
    "They show up as Interested in the applications list until they finish:",
    applicationsUrl,
    "",
    "CurioLab",
  ].join("\n");
  const html = [
    "<p>Someone just started an application on CurioLab.</p>",
    `<p><strong>Email:</strong> ${input.leadEmail}<br>`,
    `<strong>Chapter:</strong> ${input.chapter}<br>`,
    `<strong>Started by:</strong> ${input.fillerRole}<br>`,
    `<strong>How did you hear:</strong> ${source}</p>`,
    `<p>They show up as Interested in the applications list until they finish:<br>`,
    `<a href="${applicationsUrl}">${applicationsUrl}</a></p>`,
    "<p>CurioLab</p>",
  ].join("");
  return { subject, text, html };
}

/**
 * The recipient of the director notification: DIRECTOR_NOTIFY_EMAIL, or the
 * director's address as the default. Exported for reuse by the route.
 */
export function directorNotifyRecipient(): string {
  return process.env.DIRECTOR_NOTIFY_EMAIL ?? "esong@acuriolab.org";
}

/**
 * Send the director the "someone applied" alert. Throws on failure (Resend error
 * or missing key) — the caller treats sending as best-effort so a delivery failure
 * never loses the already-created lead.
 */
export async function sendDirectorLeadNotification(input: DirectorLeadNotificationInput): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  const { subject, text, html } = buildDirectorLeadNotification(input);
  await new Resend(key).emails.send({ from: FROM, to: directorNotifyRecipient(), subject, text, html });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:web -- test/apply-mail.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/emails/apply-mail.ts test/apply-mail.test.ts
git commit -m "feat(apply): director lead-notification email builder + sender"
```

---

### Task 2: Fire the notification from /api/apply on a fresh lead

**Files:**
- Modify: `app/api/apply/route.ts`

**Note on testing:** this is a best-effort side effect calling Resend directly (no injection seam), mirroring the existing untested `sendParentContinueEmail` wiring in the same route. The email CONTENT is covered by Task 1's builder test; this task adds the guarded call only. No new automated test — verified by typecheck.

- [ ] **Step 1: Add the guarded, best-effort send**

In `app/api/apply/route.ts`, update the import and add the send after the existing continue-link block, inside the `try`, before the `return Response.json(...)`. Only fire for a FRESH lead (`!result.suppressed`).

Change the import line:

```ts
import { sendParentContinueEmail, sendDirectorLeadNotification } from '@/lib/emails/apply-mail'
```

Add after the existing `if (result.parentToken && process.env.RESEND_API_KEY) { ... }` block:

```ts
    // Notify the director of every FRESH lead (an in-window duplicate is suppressed
    // upstream, so no repeat alerts). Best-effort: a send failure must not lose the
    // lead, so it is logged and swallowed — identical to the continue-link send above.
    if (!result.suppressed && process.env.RESEND_API_KEY) {
      const origin = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin
      try {
        await sendDirectorLeadNotification({ leadEmail: email, chapter, fillerRole, source, appUrl: origin })
      } catch (mailErr) {
        console.error('[api/apply] director notification failed (lead still created):', mailErr)
      }
    }
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors referencing `app/api/apply/route.ts`.

- [ ] **Step 3: Verify the existing funnel test still passes**

Run: `npm run test:web -- test/apply-funnel-flow.test.ts`
Expected: PASS (RESEND_API_KEY is unset in tests, so the new block is skipped and behavior is unchanged).

- [ ] **Step 4: Commit**

```bash
git add app/api/apply/route.ts
git commit -m "feat(apply): notify director on every fresh Apply click"
```

---

### Task 3: Union open leads into listApplications as `interested`

**Files:**
- Modify: `packages/app/src/ops-read.ts`
- Test: `packages/http/test/ops-read.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/http/test/ops-read.test.ts`, add this helper next to `submittedApplication` (after line ~107):

```ts
/** An OPEN (not-yet-converted, unexpired) lead in `chapter`. Returns its lead id. */
async function openLead(
  chapter: string,
  email = 'lead@example.test',
  fillerRole: 'parent' | 'student' = 'parent',
): Promise<string> {
  const [lead] = await h.sql`
    insert into application_lead (email, chapter, chapter_id, filler_role, status, expires_at)
    values (${email}, 'code', ${chapter}, ${fillerRole}, 'new', now() + interval '30 days')
    returning id
  `
  return lead!.id as string
}
```

Add a new describe block at the end of the file:

```ts
// ===========================================================================
describe('listApplications — Interested leads (open, not-yet-converted)', () => {
  test('an open lead appears as an interested item with email + fillerRole, non-converted', async () => {
    const a = await seedDirector(h.sql)
    await openLead(a.chapter, 'wants-in@example.test', 'student')
    const res = await listApplications({
      sql: h.sql,
      sessionToken: a.directorToken,
      query: { termId: 'all', view: 'full' },
    })
    const lead = res.body.items.find((i) => i.contactEmail === 'wants-in@example.test')
    expect(lead).toBeDefined()
    expect(lead!.status).toBe('interested')
    expect(lead!.isLead).toBe(true)
    expect(lead!.fillerRole).toBe('student')
    expect(lead!.studentName).toBeNull()
  })

  test('converted, expired, and soft-deleted leads do NOT appear as interested', async () => {
    const a = await seedDirector(h.sql)
    const app = await submittedApplication(a.chapter)
    // converted
    await h.sql`insert into application_lead (email, chapter, chapter_id, filler_role, status, expires_at, converted_application_id)
      values ('converted@example.test', 'code', ${a.chapter}, 'parent', 'converted', now() + interval '30 days', ${app})`
    // expired
    await h.sql`insert into application_lead (email, chapter, chapter_id, filler_role, status, expires_at)
      values ('expired@example.test', 'code', ${a.chapter}, 'parent', 'new', now() - interval '1 day')`
    // soft-deleted
    await h.sql`insert into application_lead (email, chapter, chapter_id, filler_role, status, expires_at, deleted_at)
      values ('deleted@example.test', 'code', ${a.chapter}, 'parent', 'new', now() + interval '30 days', now())`

    const res = await listApplications({ sql: h.sql, sessionToken: a.directorToken, query: { termId: 'all', view: 'full' } })
    const emails = res.body.items.map((i) => i.contactEmail)
    expect(emails).not.toContain('converted@example.test')
    expect(emails).not.toContain('expired@example.test')
    expect(emails).not.toContain('deleted@example.test')
  })

  test('a lead is shown even under a specific-term filter (leads have no term)', async () => {
    const a = await seedDirector(h.sql)
    await openLead(a.chapter, 'termless@example.test')
    // Any real term id from the seed; leads are not term-filtered.
    const [term] = await h.sql`select id from term where chapter_id = ${a.chapter} limit 1`
    const res = await listApplications({
      sql: h.sql,
      sessionToken: a.directorToken,
      query: { termId: term!.id as string, view: 'full' },
    })
    expect(res.body.items.map((i) => i.contactEmail)).toContain('termless@example.test')
  })

  test('the status filter includes/excludes leads', async () => {
    const a = await seedDirector(h.sql)
    const submitted = await submittedApplication(a.chapter)
    await openLead(a.chapter, 'statusfilter@example.test')

    const onlySubmitted = await listApplications({ sql: h.sql, sessionToken: a.directorToken, query: { status: 'submitted', termId: 'all', view: 'full' } })
    expect(onlySubmitted.body.items.map((i) => i.contactEmail)).not.toContain('statusfilter@example.test')
    expect(onlySubmitted.body.items.map((i) => i.applicationId)).toContain(submitted)

    const onlyInterested = await listApplications({ sql: h.sql, sessionToken: a.directorToken, query: { status: 'interested', termId: 'all', view: 'full' } })
    const ids = onlyInterested.body.items.map((i) => i.applicationId)
    expect(onlyInterested.body.items.map((i) => i.contactEmail)).toContain('statusfilter@example.test')
    expect(ids).not.toContain(submitted)
  })

  test('a lead is confined to its own chapter', async () => {
    const a = await seedDirector(h.sql)
    const b = await seedDirector(h.sql)
    await openLead(a.chapter, 'a-only@example.test')
    const seenByB = await listApplications({ sql: h.sql, sessionToken: b.directorToken, query: { termId: 'all', view: 'full' } })
    expect(seenByB.body.items.map((i) => i.contactEmail)).not.toContain('a-only@example.test')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @curiolab/http -- ops-read.test.ts`
Expected: FAIL — leads are not in the list; `isLead`/`fillerRole` are undefined.

- [ ] **Step 3: Add the item fields**

In `packages/app/src/ops-read.ts`, extend `ApplicationListItem` (after the `contactEmail?` field, ~line 88):

```ts
  /** Present on synthetic lead rows: 'parent' | 'student'. Absent on real applications. */
  fillerRole?: 'parent' | 'student'
  /** True on a synthetic Interested lead row (no application detail exists for it). */
  isLead?: boolean
```

- [ ] **Step 4: Union leads into `listApplications`**

In `packages/app/src/ops-read.ts`, inside `listApplications`, after the application `items` are built (after line ~447, before the `return { items, ... }`), insert the lead read + merge:

```ts
    // ---- Interested leads: open (not-yet-converted, unexpired) application_leads.
    // They carry no term, so they are shown regardless of the term filter; they are
    // included unless a status filter is present that omits 'interested'.
    const includeLeads = statuses === null || statuses.includes('interested')
    let leadItems: ApplicationListItem[] = []
    if (includeLeads) {
      const leadRows = await sql`
        select l.id, l.email, l.filler_role, l.chapter_id, l.created_at
        from application_lead l
        where l.converted_application_id is null
          and l.deleted_at is null
          and l.expires_at > now()
          and ${chapters === null ? sql`true` : sql`l.chapter_id in ${sql(chapters)}`}
        order by l.created_at desc
      `
      leadItems = leadRows.map((r) => {
        const item: ApplicationListItem = {
          applicationId: `lead:${r.id as string}`,
          status: 'interested',
          studentName: null,
          gradeLevel: null,
          submittedAt: iso(r.created_at),
          chapterId: r.chapter_id as string,
          termId: null,
          termName: null,
          fillerRole: r.filler_role as 'parent' | 'student',
          isLead: true,
        }
        if (full) {
          item.guardianName = null
          item.school = null
          item.contactEmail = r.email as string
        }
        return item
      })
    }

    // Merge leads with applications, newest first by submittedAt (ISO strings sort lexically).
    const merged = [...items, ...leadItems].sort((x, y) => (x.submittedAt < y.submittedAt ? 1 : x.submittedAt > y.submittedAt ? -1 : 0))
```

Then change the return to use `merged`:

```ts
    return {
      items: merged,
      activeTermId: filterTerm ? filterTerm.id : null,
      activeTermName: filterTerm ? filterTerm.name : null,
    }
```

Note: `contactEmail` (the lead email) is only attached under `view=full`, matching how application PII is data-minimized. The frontend always requests `view=full` (Task 5), so the Interested row always has the email.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -w @curiolab/http -- ops-read.test.ts`
Expected: PASS (existing listApplications tests + the 5 new lead tests).

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/ops-read.ts packages/http/test/ops-read.test.ts
git commit -m "feat(ops): surface open leads as Interested in the applications list"
```

---

### Task 4: Frontend data layer — interested status, lead fields, always-full

**Files:**
- Modify: `lib/portal/director/applications-data.ts`

**Note:** no unit test — this module is exercised by the page (Task 5) and the existing `test/director-nav.test.ts` / `test/portal-visibility.test.ts`, which run in Step 3.

- [ ] **Step 1: Add `interested` to the status type and lead fields to the row**

In `lib/portal/director/applications-data.ts`:

Change the status type (line 3):

```ts
export type ApplicationStatus = "interested" | "submitted" | "screening" | "interview" | "accepted" | "declined";
```

Add to `ApplicationRow` (after `contactEmail?`, ~line 15):

```ts
  fillerRole?: "parent" | "student" | null;
  isLead?: boolean;
```

- [ ] **Step 2: Map the interested status and pass through lead fields**

Update `mapAppStatus` (add as the FIRST check, ~line 119):

```ts
  if (s === "interested") return "interested";
```

Add to `LiveListItem` (after `contactEmail?`, ~line 201):

```ts
  fillerRole?: "parent" | "student" | null;
  isLead?: boolean;
```

- [ ] **Step 3: Always fetch full view; drop the `full` toggle plumbing**

In `applications-data.ts`:

Remove `full` from `ApplicationsView` (delete the `full: boolean;` line, ~line 46).

Change `getApplicationsView`'s signature and body to always use full. Replace the whole `getApplicationsView` function's option handling so it no longer takes `full`:

- Change signature to `export async function getApplicationsView(opts?: { termId?: string }): Promise<ApplicationsView> {`
- Delete the `const full = opts?.full ?? false;` line.
- In the sample-branch return object, delete `full,`.
- In the live path, always set `params.set("view", "full");` (unconditionally, replacing the `if (full) ...` line).
- In the mapped item, always populate the full fields and add the lead fields:

```ts
    const applications: ApplicationRow[] = (data.items ?? []).map((a, i) => ({
      applicationId: a.applicationId ?? `app${i}`,
      status: mapAppStatus(a.status),
      studentName: a.studentName ?? "—",
      gradeLevel: a.gradeLevel ?? null,
      termName: a.termName ?? null,
      submittedLabel: fmt(a.submittedAt),
      guardianName: a.guardianName ?? null,
      school: a.school ?? null,
      contactEmail: a.contactEmail ?? null,
      fillerRole: a.fillerRole ?? null,
      isLead: a.isLead ?? false,
    }));
```

- In both live and error/sample returns, delete every `full,` property (the field no longer exists on `ApplicationsView`).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: errors ONLY in `app/portal/director/applications/page.tsx` and `components/portal/director/ApplicationsControls.tsx` (they still reference the removed `full`/`view` — fixed in Task 5). No errors in `applications-data.ts`.

- [ ] **Step 5: Commit**

```bash
git add lib/portal/director/applications-data.ts
git commit -m "feat(portal): interested status + lead fields, always full view in data layer"
```

---

### Task 5: Frontend list — remove toggle, per-status colors, interested rows, live refresh

**Files:**
- Create: `components/portal/director/AutoRefresh.tsx`
- Modify: `app/portal/director/applications/page.tsx`
- Modify: `components/portal/director/ApplicationsControls.tsx`

- [ ] **Step 1: Create the auto-refresh client component**

Create `components/portal/director/AutoRefresh.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-runs the server component on an interval so the applications list stays live
 * (new Interested leads + status changes appear without a manual reload). Polling
 * keeps the existing server-side fetch as the single source of truth.
 */
export default function AutoRefresh({ intervalMs = 20000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
```

- [ ] **Step 2: Remove the view toggle from the controls**

Replace `components/portal/director/ApplicationsControls.tsx` entirely:

```tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { TermOption } from "@/lib/portal/director/applications-data";

/**
 * Term filter for the applications list. Client-side so the native <select> can
 * navigate. (The Partial/Full view toggle was removed — the list is always full.)
 */
export default function ApplicationsControls({
  terms,
  activeTermId,
}: {
  terms: TermOption[];
  activeTermId: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();

  // With no explicit ?term, the backend defaults to the most-recent term (activeTermId).
  const selectedTerm = params.get("term") ?? activeTermId ?? "all";

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value === null) next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    router.push(qs ? `/portal/director/applications?${qs}` : "/portal/director/applications");
  }

  return (
    <div className="flex items-center gap-2 flex-wrap shrink-0">
      <select
        value={selectedTerm}
        onChange={(e) => setParam("term", e.target.value)}
        aria-label="Filter by term"
        className="rounded-lg border border-ink/10 bg-white px-2.5 py-1.5 text-xs font-semibold text-ink/70 focus:outline-none focus:ring-2"
        style={{ ["--tw-ring-color" as string]: "var(--pt-accent-soft)" }}
      >
        {terms.map((t) => (
          <option key={t.termId} value={t.termId}>{t.name}</option>
        ))}
        <option value="all">All terms</option>
      </select>
    </div>
  );
}
```

- [ ] **Step 3: Rewrite the list page — always full, per-status colors, interested rows, AutoRefresh**

Replace `app/portal/director/applications/page.tsx` entirely:

```tsx
import Link from "next/link";
import { getApplicationsView, getTerms, gradeLabel, type ApplicationStatus } from "@/lib/portal/director/applications-data";
import ApplicationsControls from "@/components/portal/director/ApplicationsControls";
import AutoRefresh from "@/components/portal/director/AutoRefresh";
import SampleBanner from "@/components/portal/SampleBanner";

const STATUS_LABEL: Record<ApplicationStatus, string> = {
  interested: "Interested",
  submitted: "Submitted",
  screening: "Screening",
  interview: "Interview",
  accepted: "Accepted",
  declined: "Declined",
};

// Each status carries its own soft-badge color (bg + readable fg). Interested is
// neutral gray; the rest are distinct so the list scans at a glance.
const STATUS_COLOR: Record<ApplicationStatus, { bg: string; fg: string }> = {
  interested: { bg: "#EEF0F2", fg: "#55606B" },
  submitted: { bg: "#E4EDFB", fg: "#2456B8" },
  screening: { bg: "#FBF0DA", fg: "#8A5A00" },
  interview: { bg: "#EEE7FB", fg: "#6B39B6" },
  accepted: { bg: "#E1F3E7", fg: "#1E7A45" },
  declined: { bg: "#FBE6E8", fg: "#B23345" },
};

// Single (full) column template — the header row and every row share it so columns line up.
const COLS = "minmax(0,1.5fr) 5.5rem minmax(0,1.5fr) minmax(0,2fr) minmax(0,1.3fr) 5.5rem";

function StatusBadge({ status }: { status: ApplicationStatus }) {
  const c = STATUS_COLOR[status];
  return (
    <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap" style={{ background: c.bg, color: c.fg }}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ term?: string }> }) {
  const { term } = await searchParams;
  const [{ terms }, appsView] = await Promise.all([
    getTerms(),
    getApplicationsView({ termId: term }),
  ]);
  const { applications, activeTermId, activeTermName, isSample } = appsView;
  const showingAll = term === "all";

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh intervalMs={20000} />
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Applications</h1>
          <p className="text-ink/60 text-sm mt-1">Review and advance applications for this chapter.</p>
        </div>
        <ApplicationsControls terms={terms} activeTermId={activeTermId} />
      </div>
      {isSample && <SampleBanner />}
      {applications.length === 0 ? (
        <p className="text-sm text-ink/50 rounded-sm border border-ink/10 bg-white px-4 py-6 text-center">
          No applications{showingAll ? "" : activeTermName ? ` for ${activeTermName}` : ""}.
        </p>
      ) : (
        <div className="rounded-sm border border-ink/10 bg-white overflow-x-auto">
          <div style={{ minWidth: "56rem" }}>
            {/* Header row */}
            <div className="grid items-center gap-3 px-4 py-2.5" style={{ gridTemplateColumns: COLS }}>
              <div className="label text-[10.5px]">Name</div>
              <div className="label text-[10.5px]">Applied</div>
              <div className="label text-[10.5px]">School</div>
              <div className="label text-[10.5px]">Email</div>
              <div className="label text-[10.5px]">Parent</div>
              <div className="label text-[10.5px] justify-self-end">Status</div>
            </div>

            {/* Rows: real applications link to their detail; Interested leads are informational (no detail page). */}
            {applications.map((a) => {
              const grade = gradeLabel(a.gradeLevel);
              const cells = (
                <>
                  {/* Name — a lead has no student name yet, so show its email + a parent/student tag. */}
                  <div className="flex items-center gap-2 min-w-0">
                    {a.isLead ? (
                      <>
                        <span className="text-sm font-mono truncate">{a.contactEmail || "—"}</span>
                        {a.fillerRole && (
                          <span className="text-[10.5px] font-semibold rounded px-1.5 py-0.5 bg-ink/5 text-ink/60 shrink-0 capitalize">{a.fillerRole}</span>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="text-sm font-medium truncate">{a.studentName}</span>
                        {grade && <span className="text-[10.5px] font-mono rounded px-1.5 py-0.5 bg-ink/5 text-ink/60 shrink-0">{grade}</span>}
                      </>
                    )}
                  </div>
                  {/* Applied */}
                  <div className="text-xs text-ink/55 whitespace-nowrap">
                    {a.submittedLabel}
                    {showingAll && a.termName ? <span className="block text-ink/40">{a.termName}</span> : null}
                  </div>
                  {/* Full columns */}
                  <div className="text-xs text-ink/55 truncate">{a.school || "—"}</div>
                  <div className="text-xs text-ink/55 font-mono truncate">{a.contactEmail || "—"}</div>
                  <div className="text-xs text-ink/55 truncate">{a.guardianName || "—"}</div>
                  {/* Status */}
                  <div className="justify-self-end">
                    <StatusBadge status={a.status} />
                  </div>
                </>
              );
              return a.isLead ? (
                <div key={a.applicationId} className="grid items-center gap-3 px-4 py-3" style={{ gridTemplateColumns: COLS }}>
                  {cells}
                </div>
              ) : (
                <Link
                  key={a.applicationId}
                  href={`/portal/director/applications/${a.applicationId}`}
                  className="grid items-center gap-3 px-4 py-3 hover:bg-cream transition-colors"
                  style={{ gridTemplateColumns: COLS }}
                >
                  {cells}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: no errors in the three touched files (no remaining references to `view`/`full`/`COLS_PARTIAL`).

- [ ] **Step 5: Run the web test suite (nav/visibility regressions)**

Run: `npm run test:web`
Expected: PASS — including `test/director-nav.test.ts`, `test/portal-visibility.test.ts`, `test/apply-mail.test.ts`, `test/apply-funnel-flow.test.ts`.

- [ ] **Step 6: Manual verification (run the app)**

Use the `run` skill to launch the app. Log in as the director/admin account, open `/portal/director/applications`, and confirm: no Partial/Full toggle, statuses render in distinct colors, an Interested row (submit `/apply` in another tab to create a lead) shows the email + a Parent/Student tag and is not clickable, and the list picks up the new lead within ~20s without a manual reload.

- [ ] **Step 7: Commit**

```bash
git add app/portal/director/applications/page.tsx components/portal/director/ApplicationsControls.tsx components/portal/director/AutoRefresh.tsx
git commit -m "feat(portal): drop view toggle, per-status colors, live Interested rows"
```

---

## Self-Review Notes

- **Spec coverage:** §1 email → Tasks 1-2; §2 backend leads → Task 3; §3 remove partial + colors + interested rows → Tasks 4-5; §4 real-time → Task 5 (AutoRefresh). All covered.
- **Type consistency:** `fillerRole`/`isLead` added on the backend `ApplicationListItem` (Task 3), the frontend `LiveListItem` + `ApplicationRow` (Task 4), and consumed in the page (Task 5). `ApplicationStatus` gains `"interested"` in both the page's `STATUS_LABEL`/`STATUS_COLOR` and the data-layer type. `getApplicationsView` loses its `full` opt in Task 4 and its only caller is updated in Task 5.
- **`applicationId` for leads** is prefixed `lead:` and such rows are never wrapped in a detail `<Link>`, so the non-existent `/applications/lead:<id>` route is never navigated to.
- **Coordination:** Task 3 is the only backend-file edit; `packages/app/src/ops-read.ts` was confirmed clean/committed before planning. Tasks 1,2,4,5 are frontend/email and independent.
