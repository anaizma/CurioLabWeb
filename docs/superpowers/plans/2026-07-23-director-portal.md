# Director Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Chapter Director portal (`/portal/director/*`, red theme) — shell + dashboard + the guardian-mediated invite→account flow + public accept pages — live now, with fallback-data seams for the surfaces still awaiting backend GETs.

**Architecture:** Reuse the shipped portal foundation (`PortalShell`, `data-portal` theme tokens, `SiteChrome`, the `cl_session`→session→resource seam). `PortalShell` gains an optional grouped sidebar (additive; student unchanged). Each director surface reads live where a GET exists (moderation, audit) and returns clearly-marked representative fallback (`isSample`) otherwise. Phase 1 (this plan) touches only endpoints that exist today: `POST /api/ops/invites`, `POST /api/ops/invites/{id}/resend`, `GET /api/invites/{token}`, `POST /api/invites/{token}/accept(-student)`, `GET /api/auth/session`.

**Tech Stack:** Next.js 16 App Router (webpack build — `npm run dev|build --webpack`), React server + client components, Tailwind v4, Vitest (`npm run test:web`, `@/` alias).

**Spec:** `docs/superpowers/specs/2026-07-23-director-portal-design.md`
**Backend reads needed (Phases 2–4):** `docs/platform/director-portal-read-endpoints.md`

**Shared-branch rules:** additive only; stage **exact files** (never `git add -A`); no `packages/*` edits; end each commit message with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

---

## File structure (Phase 1)

Modify:
- `components/portal/PortalShell.tsx` — add optional `sidebar` prop + two-column layout.
- `components/SiteChrome.tsx` — also hide marketing chrome on `/invite`.

Create — pure helpers (unit-tested):
- `lib/portal/director/pick-chapter.ts` — `pickDirectorChapter(memberships)`.
- `lib/portal/director/invite-kind.ts` — `inviteKindToPortal(kind)`.
- `lib/portal/director/nav.ts` — `DIRECTOR_NAV` + `activeFrom(pathname)`.
- `test/director-pick-chapter.test.ts`, `test/invite-kind.test.ts`, `test/director-nav.test.ts`.

Create — data seams + types:
- `lib/portal/director/types.ts`
- `lib/portal/director/session.ts` — `getDirectorContext()`.
- `lib/portal/director/dashboard-data.ts`, `lib/portal/director/invites-data.ts`.

Create — UI:
- `components/portal/SampleBanner.tsx`, `components/portal/DirectorStub.tsx`
- `app/portal/director/layout.tsx` (client), `app/portal/director/page.tsx` (dashboard)
- `app/portal/director/invites/page.tsx` + `invites-client.tsx`
- `app/invite/[token]/page.tsx` + `accept-client.tsx`
- Stub pages: `app/portal/director/{applications,enrollments,members,guardianships,moderation,media,requests,pods,content,audit}/page.tsx`

---

## Task 1: Extend PortalShell with an optional sidebar

**Files:**
- Modify: `components/portal/PortalShell.tsx`

- [ ] **Step 1: Replace the component with the sidebar-capable version**

Rewrite `components/portal/PortalShell.tsx` to:

```tsx
import Link from "next/link";

export interface PortalNavItem {
  label: string;
  href: string;
}

export interface PortalNavGroup {
  title: string;
  items: PortalNavItem[];
}

/**
 * Shared portal chrome. Ink top bar (brand + role label + avatar) always.
 * Pass `nav` for the student-style top-bar tabs, OR `sidebar` for an ops-style
 * grouped left rail (director). When `sidebar` is set the top-bar tabs are
 * suppressed and children render in a two-column [rail | content] region.
 * Children read --pt-* accent tokens via the data-portal wrapper either way.
 */
export default function PortalShell({
  role,
  roleLabel,
  nav,
  sidebar,
  activeHref,
  avatarInitial,
  children,
}: {
  role: string;
  roleLabel: string;
  nav?: PortalNavItem[];
  sidebar?: PortalNavGroup[];
  activeHref: string;
  avatarInitial: string;
  children: React.ReactNode;
}) {
  return (
    <div data-portal={role} className="min-h-screen bg-cream text-ink">
      <header className="bg-ink text-white">
        <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between gap-6">
          <div className="flex items-center gap-2.5 font-bold">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--pt-accent)" }} />
            CurioLab
            <span className="font-normal text-white/55 text-sm ml-1">{roleLabel}</span>
          </div>
          {!sidebar && nav && (
            <nav className="hidden sm:flex items-center gap-6 text-sm">
              {nav.map((item) => {
                const on = item.href === activeHref;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={on ? "font-semibold text-white" : "text-white/60 hover:text-white transition-colors"}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          )}
          <div
            className="w-8 h-8 rounded-full grid place-items-center text-xs font-bold text-white"
            style={{ background: "var(--pt-accent)" }}
          >
            {avatarInitial}
          </div>
        </div>
      </header>

      {sidebar ? (
        <div className="mx-auto max-w-6xl px-6 py-8 flex gap-8">
          <aside className="hidden md:block w-52 shrink-0">
            <nav className="flex flex-col gap-6 text-sm">
              {sidebar.map((group) => (
                <div key={group.title} className="flex flex-col gap-1.5">
                  <div className="label text-[11px] uppercase tracking-wide text-ink/40">{group.title}</div>
                  {group.items.map((item) => {
                    const on = item.href === activeHref;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={on ? "font-semibold" : "text-ink/60 hover:text-ink transition-colors"}
                        style={on ? { color: "var(--pt-accent)" } : undefined}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              ))}
            </nav>
          </aside>
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
```

Note: `nav` becomes optional — the student layout still passes it, so that path is unchanged. The top-bar max-width widened to `max-w-6xl` to match the sidebar layout; the non-sidebar branch still renders `children` full-width as before.

- [ ] **Step 2: Verify the build compiles and the student portal is unaffected**

Run: `npm run build --webpack`
Expected: build succeeds; `/portal/student` still in the route list. (If a dev server is running, load `/portal/student` — top-nav tabs unchanged.)

- [ ] **Step 3: Commit**

```bash
git add components/portal/PortalShell.tsx
git commit -m "feat(portal): add optional grouped sidebar to PortalShell" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Hide marketing chrome on /invite

**Files:**
- Modify: `components/SiteChrome.tsx`

- [ ] **Step 1: Broaden the app-route check**

In `components/SiteChrome.tsx`, replace the `isPortal` line:

```tsx
  const pathname = usePathname();
  const isAppRoute =
    (pathname?.startsWith("/portal") ?? false) || (pathname?.startsWith("/invite") ?? false);
```

and use `!isAppRoute` in place of `!isPortal` in the two conditionals. Update the JSDoc to say "except on `/portal` and `/invite` routes, which supply their own shell."

- [ ] **Step 2: Verify build**

Run: `npm run build --webpack`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add components/SiteChrome.tsx
git commit -m "feat(portal): hide marketing chrome on /invite onboarding pages" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `pickDirectorChapter` (pure helper, TDD)

**Files:**
- Create: `lib/portal/director/pick-chapter.ts`
- Test: `test/director-pick-chapter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/director-pick-chapter.test.ts
import { describe, it, expect } from "vitest";
import { pickDirectorChapter } from "@/lib/portal/director/pick-chapter";

describe("pickDirectorChapter", () => {
  it("returns the chapterId of a chapter_director membership", () => {
    expect(
      pickDirectorChapter([
        { role: "student", chapterId: "c1" },
        { role: "chapter_director", chapterId: "c2" },
      ]),
    ).toBe("c2");
  });

  it("returns null when there is no director membership", () => {
    expect(pickDirectorChapter([{ role: "student", chapterId: "c1" }])).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(pickDirectorChapter([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test:web -- director-pick-chapter`
Expected: FAIL — cannot resolve `@/lib/portal/director/pick-chapter`.

- [ ] **Step 3: Implement the helper**

```ts
// lib/portal/director/pick-chapter.ts
export interface SessionMembership {
  chapterId?: string;
  role?: string;
  status?: string;
}

/** The chapterId of the caller's chapter_director membership, or null. */
export function pickDirectorChapter(memberships: SessionMembership[]): string | null {
  const m = memberships.find((x) => x.role === "chapter_director");
  return m?.chapterId ?? null;
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm run test:web -- director-pick-chapter`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/portal/director/pick-chapter.ts test/director-pick-chapter.test.ts
git commit -m "feat(director): pickDirectorChapter session helper" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `inviteKindToPortal` (pure helper, TDD)

**Files:**
- Create: `lib/portal/director/invite-kind.ts`
- Test: `test/invite-kind.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/invite-kind.test.ts
import { describe, it, expect } from "vitest";
import { inviteKindToPortal } from "@/lib/portal/director/invite-kind";

describe("inviteKindToPortal", () => {
  it("maps guardian to the parent portal", () => {
    expect(inviteKindToPortal("guardian")).toBe("parent");
  });
  it("maps mentor to the mentor portal", () => {
    expect(inviteKindToPortal("mentor")).toBe("mentor");
  });
  it("maps staff to the director portal", () => {
    expect(inviteKindToPortal("staff")).toBe("director");
  });
  it("maps student to the student portal", () => {
    expect(inviteKindToPortal("student")).toBe("student");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test:web -- invite-kind`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/portal/director/invite-kind.ts
export type InviteKind = "guardian" | "mentor" | "staff" | "student";
export type PortalName = "parent" | "mentor" | "director" | "student";

/** Which portal an accepted invite of each kind ultimately lands the account in. */
export function inviteKindToPortal(kind: InviteKind): PortalName {
  switch (kind) {
    case "guardian":
      return "parent";
    case "mentor":
      return "mentor";
    case "staff":
      return "director";
    case "student":
      return "student";
  }
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm run test:web -- invite-kind`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/portal/director/invite-kind.ts test/invite-kind.test.ts
git commit -m "feat(director): inviteKindToPortal mapping" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Director nav + `activeFrom` (TDD)

**Files:**
- Create: `lib/portal/director/nav.ts`
- Test: `test/director-nav.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/director-nav.test.ts
import { describe, it, expect } from "vitest";
import { activeFrom } from "@/lib/portal/director/nav";

describe("activeFrom", () => {
  it("matches the dashboard exactly", () => {
    expect(activeFrom("/portal/director")).toBe("/portal/director");
  });
  it("highlights a section for its own page", () => {
    expect(activeFrom("/portal/director/invites")).toBe("/portal/director/invites");
  });
  it("highlights the section for a nested detail route", () => {
    expect(activeFrom("/portal/director/applications/abc123")).toBe("/portal/director/applications");
  });
  it("falls back to the dashboard for an unknown path", () => {
    expect(activeFrom("/portal/director/nope")).toBe("/portal/director");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test:web -- director-nav`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/portal/director/nav.ts
import type { PortalNavGroup } from "@/components/portal/PortalShell";

export const DIRECTOR_NAV: PortalNavGroup[] = [
  { title: "Overview", items: [{ label: "Dashboard", href: "/portal/director" }] },
  {
    title: "Intake",
    items: [
      { label: "Applications", href: "/portal/director/applications" },
      { label: "Invites", href: "/portal/director/invites" },
      { label: "Enrollments", href: "/portal/director/enrollments" },
    ],
  },
  {
    title: "People",
    items: [
      { label: "Members", href: "/portal/director/members" },
      { label: "Guardianships", href: "/portal/director/guardianships" },
      { label: "Pods & terms", href: "/portal/director/pods" },
    ],
  },
  {
    title: "Safety",
    items: [
      { label: "Moderation", href: "/portal/director/moderation" },
      { label: "Media", href: "/portal/director/media" },
      { label: "Requests", href: "/portal/director/requests" },
    ],
  },
  { title: "Content", items: [{ label: "Newsletter & reviews", href: "/portal/director/content" }] },
  { title: "Oversight", items: [{ label: "Audit log", href: "/portal/director/audit" }] },
];

/** The nav href to highlight for a given pathname: the longest item href that the
 *  path equals or sits under (so /applications/{id} highlights Applications).
 *  Dashboard ("/portal/director") only matches exactly. Falls back to Dashboard. */
export function activeFrom(pathname: string): string {
  const items = DIRECTOR_NAV.flatMap((g) => g.items);
  const match = items
    .filter((i) => pathname === i.href || pathname.startsWith(i.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match?.href ?? "/portal/director";
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm run test:web -- director-nav`
Expected: PASS (4 tests). Note the dashboard href `/portal/director` never matches `startsWith(href + "/")` for other pages because the other hrefs are longer and win the sort; a nested applications path only satisfies the `startsWith` for the Applications item.

- [ ] **Step 5: Commit**

```bash
git add lib/portal/director/nav.ts test/director-nav.test.ts
git commit -m "feat(director): sidebar nav groups + active-route helper" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Director session context + types

**Files:**
- Create: `lib/portal/director/session.ts`
- Create: `lib/portal/director/types.ts`

- [ ] **Step 1: Write the types**

```ts
// lib/portal/director/types.ts
export type InviteStatus = "pending" | "accepted" | "expired" | "superseded";

export interface InviteRow {
  inviteId: string;
  kind: "guardian" | "mentor" | "staff";
  targetEmail: string | null;
  status: InviteStatus;
  issuedLabel: string;
  expiresLabel: string;
}

export interface DashboardSummary {
  newApplications: number;
  pendingInvites: number;
  guardianshipsToVerify: number;
  mediaToReview: number;
  openRequests: number;
  activeMembers: number;
  isSample: boolean;
}
```

- [ ] **Step 2: Write the session helper**

```ts
// lib/portal/director/session.ts
import { cookies, headers } from "next/headers";
import { pickDirectorChapter, type SessionMembership } from "./pick-chapter";

export interface DirectorContext {
  origin: string;
  cookie: string;
  chapterId: string;
  accountId: string;
}

interface SessionResp {
  accountId?: string;
  memberships?: SessionMembership[];
}

/** Read cl_session → GET /api/auth/session, require a chapter_director membership.
 *  Returns the director's request context, or null (→ representative fallback). */
export async function getDirectorContext(): Promise<DirectorContext | null> {
  try {
    const session = (await cookies()).get("cl_session");
    if (!session) return null;
    const h = await headers();
    const host = h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "http";
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? (host ? `${proto}://${host}` : "");
    if (!origin) return null;
    const cookie = `cl_session=${session.value}`;

    const sres = await fetch(`${origin}/api/auth/session`, { headers: { cookie }, cache: "no-store" });
    if (!sres.ok) return null;
    const s = (await sres.json()) as SessionResp;
    const chapterId = pickDirectorChapter(s.memberships ?? []);
    if (!s.accountId || !chapterId) return null;
    return { origin, cookie, chapterId, accountId: s.accountId };
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build --webpack`
Expected: succeeds (types compile).

- [ ] **Step 4: Commit**

```bash
git add lib/portal/director/session.ts lib/portal/director/types.ts
git commit -m "feat(director): session context seam + surface types" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Shared portal affordances (SampleBanner, DirectorStub)

**Files:**
- Create: `components/portal/SampleBanner.tsx`
- Create: `components/portal/DirectorStub.tsx`

- [ ] **Step 1: SampleBanner**

```tsx
// components/portal/SampleBanner.tsx
export default function SampleBanner() {
  return (
    <div
      className="text-xs rounded-lg px-3 py-2 border"
      style={{
        background: "var(--pt-accent-soft)",
        borderColor: "var(--pt-accent-border)",
        color: "var(--pt-accent-fg)",
      }}
    >
      Sample data — representative content shown until this chapter&apos;s live data is connected.
    </div>
  );
}
```

- [ ] **Step 2: DirectorStub**

```tsx
// components/portal/DirectorStub.tsx
export default function DirectorStub({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="text-ink/60 text-sm max-w-prose">{note}</p>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/portal/SampleBanner.tsx components/portal/DirectorStub.tsx
git commit -m "feat(director): shared sample-data banner + surface stub" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Director layout + dashboard

**Files:**
- Create: `lib/portal/director/dashboard-data.ts`
- Create: `app/portal/director/layout.tsx`
- Create: `app/portal/director/page.tsx`

- [ ] **Step 1: Dashboard data seam**

```ts
// lib/portal/director/dashboard-data.ts
import type { DashboardSummary } from "./types";
import { getDirectorContext } from "./session";

const SAMPLE_SUMMARY: DashboardSummary = {
  newApplications: 4,
  pendingInvites: 3,
  guardianshipsToVerify: 2,
  mediaToReview: 1,
  openRequests: 0,
  activeMembers: 18,
  isSample: true,
};

/** No chapter-summary GET exists yet (see director-portal-read-endpoints.md).
 *  Return the representative summary until GET /api/ops/dashboard (or the list
 *  GETs it derives from) land; isSample stays true so the banner shows. */
export async function getDashboardSummary(): Promise<DashboardSummary> {
  const ctx = await getDirectorContext();
  if (!ctx) return SAMPLE_SUMMARY;
  // TODO(wire): derive real counts once the surface GETs exist.
  return SAMPLE_SUMMARY;
}
```

- [ ] **Step 2: Layout (client — computes the active sidebar item)**

```tsx
// app/portal/director/layout.tsx
"use client";

import { usePathname } from "next/navigation";
import PortalShell from "@/components/portal/PortalShell";
import { DIRECTOR_NAV, activeFrom } from "@/lib/portal/director/nav";

export default function DirectorPortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/portal/director";
  return (
    <PortalShell
      role="director"
      roleLabel="Chapter Director"
      sidebar={DIRECTOR_NAV}
      activeHref={activeFrom(pathname)}
      avatarInitial="D"
    >
      {children}
    </PortalShell>
  );
}
```

(A client layout may wrap server-component pages passed as `children` — the children still render on the server.)

- [ ] **Step 3: Dashboard page**

```tsx
// app/portal/director/page.tsx
import { getDashboardSummary } from "@/lib/portal/director/dashboard-data";
import SampleBanner from "@/components/portal/SampleBanner";

export default async function DirectorDashboardPage() {
  const s = await getDashboardSummary();
  const cards = [
    { label: "New applications", value: s.newApplications, href: "/portal/director/applications" },
    { label: "Pending invites", value: s.pendingInvites, href: "/portal/director/invites" },
    { label: "Guardianships to verify", value: s.guardianshipsToVerify, href: "/portal/director/guardianships" },
    { label: "Media to review", value: s.mediaToReview, href: "/portal/director/media" },
    { label: "Open requests", value: s.openRequests, href: "/portal/director/requests" },
    { label: "Active members", value: s.activeMembers, href: "/portal/director/members" },
  ];
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Chapter dashboard</h1>
        <p className="text-ink/60 text-sm mt-1">Everything waiting on you across intake, roster, and safety.</p>
      </div>
      {s.isSample && <SampleBanner />}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {cards.map((c) => (
          <a
            key={c.href}
            href={c.href}
            className="rounded-xl border border-ink/10 bg-white p-5 hover:border-ink/20 transition-colors"
          >
            <div className="text-3xl font-bold" style={{ color: "var(--pt-accent)" }}>
              {c.value}
            </div>
            <div className="text-sm text-ink/60 mt-1">{c.label}</div>
          </a>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify build** (dashboard links resolve after Task 9 adds the stubs; that's fine — build doesn't check link targets)

Run: `npm run build --webpack`
Expected: succeeds; `/portal/director` appears in the route list.

- [ ] **Step 5: Commit**

```bash
git add lib/portal/director/dashboard-data.ts app/portal/director/layout.tsx app/portal/director/page.tsx
git commit -m "feat(director): portal layout + dashboard home" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Stub pages for the remaining surfaces (prevents nav 404s)

**Files (all Create):**
- `app/portal/director/applications/page.tsx`
- `app/portal/director/enrollments/page.tsx`
- `app/portal/director/members/page.tsx`
- `app/portal/director/guardianships/page.tsx`
- `app/portal/director/moderation/page.tsx`
- `app/portal/director/media/page.tsx`
- `app/portal/director/requests/page.tsx`
- `app/portal/director/pods/page.tsx`
- `app/portal/director/content/page.tsx`
- `app/portal/director/audit/page.tsx`

- [ ] **Step 1: Create each stub** (same shape; the `title`/`note` differ)

Applications:
```tsx
import DirectorStub from "@/components/portal/DirectorStub";
export default function Page() {
  return (
    <DirectorStub
      title="Applications"
      note="Review and advance applications through screen → interview → accept/decline. Wires to the chapter's application list when GET /api/ops/applications is available."
    />
  );
}
```

Enrollments:
```tsx
import DirectorStub from "@/components/portal/DirectorStub";
export default function Page() {
  return (
    <DirectorStub
      title="Enrollments"
      note="Signed enrollment records for accepted applicants. Wires to GET /api/ops/enrollments when available."
    />
  );
}
```

Members:
```tsx
import DirectorStub from "@/components/portal/DirectorStub";
export default function Page() {
  return (
    <DirectorStub
      title="Members"
      note="Chapter roster — activate pending memberships and view tiers and pods. Wires to GET /api/ops/memberships when available."
    />
  );
}
```

Guardianships:
```tsx
import DirectorStub from "@/components/portal/DirectorStub";
export default function Page() {
  return (
    <DirectorStub
      title="Guardianships"
      note="Verify guardian name-on-account against name-on-form, and revoke edges. Wires to GET /api/ops/guardianships when available."
    />
  );
}
```

Moderation:
```tsx
import DirectorStub from "@/components/portal/DirectorStub";
export default function Page() {
  return (
    <DirectorStub
      title="Moderation"
      note="The Lab moderation queue. Reads live from GET /api/lab/moderation/queue — wiring is the next build step after Phase 1."
    />
  );
}
```

Media:
```tsx
import DirectorStub from "@/components/portal/DirectorStub";
export default function Page() {
  return (
    <DirectorStub
      title="Media review"
      note="Confirm depictions, clear, or remove submitted media. Wires to GET /api/ops/media/review-queue when available."
    />
  );
}
```

Requests:
```tsx
import DirectorStub from "@/components/portal/DirectorStub";
export default function Page() {
  return (
    <DirectorStub
      title="Deletion & export requests"
      note="Review and fulfill guardian data requests. Wires to GET /api/ops/deletion-requests and /api/ops/export-requests when available."
    />
  );
}
```

Pods:
```tsx
import DirectorStub from "@/components/portal/DirectorStub";
export default function Page() {
  return (
    <DirectorStub
      title="Pods & terms"
      note="Create terms and pods and assign members. Wires to GET /api/ops/pods and /api/ops/terms when available."
    />
  );
}
```

Content:
```tsx
import DirectorStub from "@/components/portal/DirectorStub";
export default function Page() {
  return (
    <DirectorStub
      title="Newsletter & reviews"
      note="Draft the chapter newsletter and review narratives and projects for publication. Built on the existing content endpoints in a later phase."
    />
  );
}
```

Audit:
```tsx
import DirectorStub from "@/components/portal/DirectorStub";
export default function Page() {
  return (
    <DirectorStub
      title="Audit log"
      note="Chapter audit trail. Reads live from GET /api/ops/audit — wiring is a later build step."
    />
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build --webpack`
Expected: succeeds; all ten `/portal/director/*` routes appear; sidebar links + dashboard cards now resolve (no 404s).

- [ ] **Step 3: Commit**

```bash
git add app/portal/director/applications/page.tsx app/portal/director/enrollments/page.tsx app/portal/director/members/page.tsx app/portal/director/guardianships/page.tsx app/portal/director/moderation/page.tsx app/portal/director/media/page.tsx app/portal/director/requests/page.tsx app/portal/director/pods/page.tsx app/portal/director/content/page.tsx app/portal/director/audit/page.tsx
git commit -m "feat(director): stub pages for phase 2-4 surfaces" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Invites surface — data seam + page

**Files:**
- Create: `lib/portal/director/invites-data.ts`
- Create: `app/portal/director/invites/page.tsx`

- [ ] **Step 1: Invites data seam**

```ts
// lib/portal/director/invites-data.ts
import type { InviteRow } from "./types";
import { getDirectorContext } from "./session";

export interface InvitesView {
  chapterId: string | null;
  invites: InviteRow[];
  isSample: boolean;
}

const SAMPLE_INVITES: InviteRow[] = [
  { inviteId: "inv_sample_1", kind: "guardian", targetEmail: "parent@example.org", status: "pending", issuedLabel: "Jul 21", expiresLabel: "Jul 28" },
  { inviteId: "inv_sample_2", kind: "mentor", targetEmail: "mentor@example.org", status: "pending", issuedLabel: "Jul 20", expiresLabel: "Jul 27" },
  { inviteId: "inv_sample_3", kind: "staff", targetEmail: null, status: "accepted", issuedLabel: "Jul 18", expiresLabel: "—" },
];

/** Issuing + resend are LIVE (POST). No list GET exists yet, so the pending list
 *  is representative until GET /api/ops/invites lands. chapterId (present when a
 *  director is signed in) is what makes live issuing possible on the page. */
export async function getInvitesView(): Promise<InvitesView> {
  const ctx = await getDirectorContext();
  return { chapterId: ctx?.chapterId ?? null, invites: SAMPLE_INVITES, isSample: true };
}
```

- [ ] **Step 2: Invites page (server)**

```tsx
// app/portal/director/invites/page.tsx
import { getInvitesView } from "@/lib/portal/director/invites-data";
import SampleBanner from "@/components/portal/SampleBanner";
import InvitesClient from "./invites-client";

export default async function DirectorInvitesPage() {
  const view = await getInvitesView();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Invites</h1>
        <p className="text-ink/60 text-sm mt-1">
          Invite guardians, mentors, and staff to create their CurioLab accounts. Students are invited by their guardian, not here.
        </p>
      </div>
      {view.isSample && <SampleBanner />}
      <InvitesClient chapterId={view.chapterId} invites={view.invites} />
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build --webpack`
Expected: fails only on the missing `./invites-client` import — resolved in Task 11. (Do Task 11 before re-running.)

- [ ] **Step 4: Commit** (after Task 11 builds green — commit the seam + page together with the client in Task 11's commit, or stage now and commit at Task 11 Step 4. Stage now:)

```bash
git add lib/portal/director/invites-data.ts app/portal/director/invites/page.tsx
```

---

## Task 11: Invites client — issue + resend (live POST)

**Files:**
- Create: `app/portal/director/invites/invites-client.tsx`

- [ ] **Step 1: Write the client component**

```tsx
// app/portal/director/invites/invites-client.tsx
"use client";

import { useState } from "react";
import type { InviteRow } from "@/lib/portal/director/types";

type Kind = "guardian" | "mentor" | "staff";
const KIND_LABEL: Record<InviteRow["kind"], string> = { guardian: "Guardian", mentor: "Mentor", staff: "Staff" };
const inputCls = "w-full rounded-lg border border-ink/15 px-3 py-2 text-sm bg-white";

export default function InvitesClient({ chapterId, invites }: { chapterId: string | null; invites: InviteRow[] }) {
  const [kind, setKind] = useState<Kind>("guardian");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ token: string; expiresAt: string } | null>(null);
  const [resent, setResent] = useState<Record<string, { token: string; expiresAt: string }>>({});

  const canIssue = chapterId !== null;
  const linkFor = (token: string) => `${typeof window !== "undefined" ? window.location.origin : ""}/invite/${token}`;

  async function issue(e: React.FormEvent) {
    e.preventDefault();
    if (!chapterId) return;
    setBusy(true);
    setError(null);
    setIssued(null);
    try {
      const res = await fetch("/api/ops/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, chapterId, targetEmail: email.trim() || undefined }),
      });
      if (!res.ok) {
        setError(res.status === 403 ? "You don't have permission to issue invites." : "Could not issue the invite.");
        return;
      }
      const data = (await res.json()) as { token: string; expiresAt: string };
      setIssued({ token: data.token, expiresAt: data.expiresAt });
      setEmail("");
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function resend(inviteId: string) {
    setError(null);
    try {
      const res = await fetch(`/api/ops/invites/${inviteId}/resend`, { method: "POST" });
      if (!res.ok) {
        setError(res.status === 404 ? "That invite no longer exists." : "Could not resend the invite.");
        return;
      }
      const data = (await res.json()) as { token: string; expiresAt: string };
      setResent((r) => ({ ...r, [inviteId]: { token: data.token, expiresAt: data.expiresAt } }));
    } catch {
      setError("Network error — please try again.");
    }
  }

  return (
    <div className="grid md:grid-cols-2 gap-8">
      {/* Issue */}
      <form onSubmit={issue} className="rounded-2xl border border-ink/10 bg-white p-6 flex flex-col gap-4">
        <h2 className="font-bold">Issue an invite</h2>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/60">Role</span>
          <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="guardian">Guardian</option>
            <option value="mentor">Mentor</option>
            <option value="staff">Staff</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/60">Email (optional)</span>
          <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.org" />
        </label>
        <button
          type="submit"
          disabled={!canIssue || busy}
          className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          style={{ background: "var(--pt-accent)", color: "var(--pt-on-accent)" }}
        >
          {busy ? "Issuing…" : "Create invite link"}
        </button>
        {!canIssue && <p className="text-xs text-ink/50">Sign in as a Chapter Director to issue live invites.</p>}
        {error && <p className="text-xs text-coral">{error}</p>}
        {issued && (
          <div className="rounded-lg border border-ink/10 bg-cream p-3 text-sm flex flex-col gap-2">
            <span className="text-ink/60 text-xs">Shareable link (shown once) · expires {new Date(issued.expiresAt).toLocaleDateString()}</span>
            <code className="text-xs break-all">{linkFor(issued.token)}</code>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(linkFor(issued.token))}
              className="self-start text-xs font-semibold"
              style={{ color: "var(--pt-accent)" }}
            >
              Copy link
            </button>
          </div>
        )}
      </form>

      {/* Pending list */}
      <div className="rounded-2xl border border-ink/10 bg-white p-6">
        <h2 className="font-bold mb-3">Recent invites</h2>
        <ul className="flex flex-col divide-y divide-ink/5">
          {invites.map((inv) => {
            const fresh = resent[inv.inviteId];
            return (
              <li key={inv.inviteId} className="py-3 flex items-start justify-between gap-3 text-sm">
                <div>
                  <div className="font-medium">
                    {KIND_LABEL[inv.kind]}
                    <span className="text-ink/50 font-normal"> · {inv.targetEmail ?? "no email"}</span>
                  </div>
                  <div className="text-xs text-ink/50">
                    {inv.status} · issued {inv.issuedLabel} · expires {inv.expiresLabel}
                  </div>
                  {fresh && <code className="text-[11px] break-all text-ink/60">{linkFor(fresh.token)}</code>}
                </div>
                {inv.status === "pending" && (
                  <button type="button" onClick={() => resend(inv.inviteId)} className="text-xs font-semibold shrink-0" style={{ color: "var(--pt-accent)" }}>
                    Resend
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build --webpack`
Expected: succeeds; `/portal/director/invites` in the route list.

- [ ] **Step 3: Verify `text-coral` exists** (used for the error line)

Run: `npm run test:web -- invite-kind` is unrelated; instead confirm the utility: search `app/globals.css` / `@theme` for `coral`. If `text-coral` is not a generated utility, replace `className="text-xs text-coral"` with `className="text-xs" style={{ color: "var(--pt-accent-fg)" }}`.

- [ ] **Step 4: Commit** (includes the Task 10 staged files)

```bash
git add app/portal/director/invites/invites-client.tsx
git commit -m "feat(director): invites surface — issue + resend live, representative list" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: Public invite-accept page (server)

**Files:**
- Create: `app/invite/[token]/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
// app/invite/[token]/page.tsx
import { headers } from "next/headers";
import AcceptClient from "./accept-client";

interface InviteInfo {
  usable: boolean;
  kind: "guardian" | "student" | "mentor" | "staff" | null;
  chapter: string | null;
}

async function fetchInvite(token: string): Promise<InviteInfo> {
  try {
    const h = await headers();
    const host = h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "http";
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? (host ? `${proto}://${host}` : "");
    if (!origin) return { usable: false, kind: null, chapter: null };
    const res = await fetch(`${origin}/api/invites/${token}`, { cache: "no-store" });
    if (!res.ok) return { usable: false, kind: null, chapter: null };
    return (await res.json()) as InviteInfo;
  } catch {
    return { usable: false, kind: null, chapter: null };
  }
}

export default async function InviteAcceptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const info = await fetchInvite(token);
  return (
    <div className="min-h-screen bg-cream text-ink grid place-items-center px-6 py-16">
      <div className="w-full max-w-md">
        {!info.usable || !info.kind ? (
          <div className="rounded-2xl border border-ink/10 bg-white p-8 text-center">
            <h1 className="text-xl font-bold">This invite link isn&apos;t valid</h1>
            <p className="text-ink/60 text-sm mt-2">
              It may have expired or already been used. Ask your Chapter Director to send a new one.
            </p>
          </div>
        ) : (
          <AcceptClient token={token} kind={info.kind} chapter={info.chapter} />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build --webpack`
Expected: fails only on the missing `./accept-client` — resolved in Task 13.

- [ ] **Step 3: Stage**

```bash
git add app/invite/[token]/page.tsx
```

---

## Task 13: Public invite-accept client (live accept / accept-student)

**Files:**
- Create: `app/invite/[token]/accept-client.tsx`

- [ ] **Step 1: Write the client component**

```tsx
// app/invite/[token]/accept-client.tsx
"use client";

import { useState } from "react";

type Kind = "guardian" | "student" | "mentor" | "staff";
const inputCls = "w-full rounded-lg border border-ink/15 px-3 py-2 text-sm bg-white";

export default function AcceptClient({ token, kind, chapter }: { token: string; kind: Kind; chapter: string | null }) {
  const isStudent = kind === "student";
  const [form, setForm] = useState({ email: "", username: "", password: "", legalName: "", displayName: "", dateOfBirth: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const endpoint = isStudent ? `/api/invites/${token}/accept-student` : `/api/invites/${token}/accept`;
    const body = isStudent
      ? { username: form.username, password: form.password, legalName: form.legalName, displayName: form.displayName }
      : {
          email: form.email,
          password: form.password,
          legalName: form.legalName,
          displayName: form.displayName,
          dateOfBirth: form.dateOfBirth,
        };
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (res.status === 201) {
        setDone(true);
        return;
      }
      if (res.status === 400) setError("Please check the form — a field is missing or doesn't match the invite.");
      else if (res.status === 401) setError("This invite is no longer valid.");
      else if (res.status === 404) setError("We couldn't find this invite.");
      else setError("Something went wrong — please try again.");
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-ink/10 bg-white p-8 text-center">
        <h1 className="text-xl font-bold">Account created</h1>
        <p className="text-ink/60 text-sm mt-2">
          Your account is pending activation by the Chapter Director. You&apos;ll be able to sign in once it&apos;s active.
          {kind === "guardian" ? " After that, you can invite your student from your parent portal." : ""}
        </p>
      </div>
    );
  }

  const kindLabel = kind === "guardian" ? "guardian" : kind === "student" ? "student" : kind === "mentor" ? "mentor" : "staff";
  return (
    <form onSubmit={submit} className="rounded-2xl border border-ink/10 bg-white p-8 flex flex-col gap-4">
      <div>
        <div className="label text-[11px] uppercase tracking-wide text-ink/40">CurioLab{chapter ? ` · ${chapter}` : ""}</div>
        <h1 className="text-xl font-bold mt-1">Create your {kindLabel} account</h1>
      </div>

      {isStudent ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/60">Username</span>
          <input className={inputCls} value={form.username} onChange={set("username")} required autoComplete="username" />
        </label>
      ) : (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/60">Email</span>
          <input className={inputCls} type="email" value={form.email} onChange={set("email")} required autoComplete="email" />
        </label>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink/60">Password</span>
        <input className={inputCls} type="password" value={form.password} onChange={set("password")} required autoComplete="new-password" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink/60">Legal name</span>
        <input className={inputCls} value={form.legalName} onChange={set("legalName")} required />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink/60">Display name</span>
        <input className={inputCls} value={form.displayName} onChange={set("displayName")} required />
      </label>
      {!isStudent && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/60">Date of birth</span>
          <input className={inputCls} type="date" value={form.dateOfBirth} onChange={set("dateOfBirth")} required />
        </label>
      )}

      {error && <p className="text-xs" style={{ color: "var(--pt-accent-fg)" }}>{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
        style={{ background: "var(--pt-accent)", color: "var(--pt-on-accent)" }}
      >
        {busy ? "Creating…" : "Create account"}
      </button>
    </form>
  );
}
```

Note: `/invite/[token]` renders outside any `data-portal` wrapper, so `--pt-*` tokens fall back to the default (student green) values defined on the bare `[data-portal]` selector — **except** here there's no `data-portal` ancestor at all, so the custom properties are undefined and resolve to their fallbacks. To keep the accent on-brand, wrap the accept card in `<div data-portal="director">` inside `page.tsx`'s container so the red tokens apply. **Adjust Task 12**: change the outer `<div className="min-h-screen …">` to include `data-portal="director"`.

- [ ] **Step 2: Apply the data-portal fix to Task 12's page**

In `app/invite/[token]/page.tsx`, add `data-portal="director"` to the outer wrapper div:

```tsx
    <div data-portal="director" className="min-h-screen bg-cream text-ink grid place-items-center px-6 py-16">
```

- [ ] **Step 3: Verify build**

Run: `npm run build --webpack`
Expected: succeeds; `/invite/[token]` in the route list.

- [ ] **Step 4: Commit** (includes Task 12's staged page)

```bash
git add app/invite/[token]/page.tsx app/invite/[token]/accept-client.tsx
git commit -m "feat(invite): public invite-accept pages (email + username paths)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 14: Phase 1 verification

- [ ] **Step 1: Full test suite green**

Run: `npm run test:web`
Expected: PASS — including the 3 new director helper specs (pick-chapter, invite-kind, nav) plus all prior tests.

- [ ] **Step 2: Lint + build green**

Run: `npm run lint`
Run: `npm run build --webpack`
Expected: both clean; route list includes `/portal/director`, all ten `/portal/director/*` surfaces, `/portal/director/invites`, and `/invite/[token]`.

- [ ] **Step 3: Manual smoke (dev server + local DB)**

Start `node scripts/dev-db.mjs`, then `npm run dev --webpack`:
- `/portal/director` — red theme, sidebar renders, dashboard cards show sample counts + "Sample data" banner; each card/sidebar link navigates without 404.
- `/portal/director/invites` — issue form present; unauthenticated → "Sign in as a Chapter Director to issue live invites" and issue disabled; sample list shows.
- `/invite/some-bad-token` — "This invite link isn't valid" card, no marketing Nav/Footer.
- Marketing pages (`/`) still show Nav/Footer; `/portal/student` unchanged (green, top-nav).

- [ ] **Step 4: If any check fails**, fix inline and re-run Steps 1–2 before proceeding. No commit needed for a green run.

---

## Phases 2–4 (roadmap — each becomes its own bite-sized plan when its backend GET lands)

These surfaces already have their stub pages, sidebar entries, and theme in place from Phase 1. Each is built by the **same pattern as Invites**: a `lib/portal/director/<surface>-data.ts` seam (live GET when available, representative fallback + `isSample` otherwise, gated by `getDirectorContext()`), a server page rendering the list/detail, and a client component wiring the already-existing write endpoints. No new architecture.

Do **not** pre-write these against endpoints that don't exist — request the GET (see `docs/platform/director-portal-read-endpoints.md`), and when the backend agent confirms a shape, write that surface's small plan and execute it.

**Phase 2 — highest value, most-requested reads:**
- **Applications** — `GET /api/ops/applications` (list) + `/{id}` (detail); writes: `PATCH /api/ops/applications/{id}` (screen/schedule-interview/accept/decline/withdraw/reopen). Detail renders 2A/2B/2C answers read-only.
- **Members** — `GET /api/ops/memberships`; write: `POST /api/ops/memberships/{id}/activate`. Activation is what turns an accepted invite's account live → completes the invite→portal loop.

**Phase 3 — safety & rights:**
- **Moderation** — wire the stub to the **live** `GET /api/lab/moderation/queue` (buildable immediately, no backend dep).
- **Media** — `GET /api/ops/media/review-queue`; writes: confirm-depiction / clear / remove.
- **Requests** — `GET /api/ops/deletion-requests` + `/api/ops/export-requests`; writes: deletion review/fulfill, export fulfill.
- **Guardianships** — `GET /api/ops/guardianships`; writes: verify / revoke.

**Phase 4 — roster ops & content:**
- **Enrollments** — `GET /api/ops/enrollments`; write: `POST /api/ops/enrollments`.
- **Pods & terms** — `GET /api/ops/pods` + `/api/ops/terms`; writes: pods create/assign/unassign, terms create/patch.
- **Content** — narrative review (`POST /api/profile/narrative/{id}/review`), project publish/unpublish, newsletter (`POST /api/ops/newsletter` + lifecycle). Reads use existing published/public endpoints.
- **Audit** — wire the stub to the **live** `GET /api/ops/audit` (buildable immediately).

**Two surfaces are buildable now without any backend work** (Moderation, Audit — both have live GETs); pick them up right after Phase 1 if the invite flow is confirmed working.
```
