# Student Portal — Profile Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the student Profile page (hero, pinned projects, intro, composer, activity feed with a "viewing as" lens) inside a reusable portal shell with a per-role theme system (student = green), rendered from a data seam that reads real profile data when a session exists and falls back to representative data.

**Architecture:** New `/portal/student` route tree under a shared `<PortalShell>`; marketing chrome is hidden on `/portal` via a `<SiteChrome>` client wrapper. A `data-portal` attribute drives accent tokens (`--pt-*`). Presentational components take a typed `StudentProfile`; `getStudentProfile()` (server) fetches session→profile with a representative fallback. The lens is a pure client filter.

**Tech Stack:** Next.js 16 (App Router, server + client components, `next/headers`), React 19, TypeScript, Tailwind v4 (`@theme` tokens), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-23-student-portal-profile-design.md`

---

## Guardrails
- **Web app only** — `app/`, `components/`, `lib/`, `test/`. Do NOT touch `packages/*`.
- Shared branch: `git add` exact files per task, never `git add -A`.
- Design system: Nunito Sans body, JetBrains-mono labels (`.label` class), CurioLab palette (`text-ink`, `text-muted`, `bg-cream`, `bg-sage`, etc. from `app/globals.css @theme`). Portal accent via `var(--pt-accent)` etc.
- JSX text apostrophes: use `&apos;` (eslint `react/no-unescaped-entities`).
- Read `node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md` before Tasks 3–4 (async layouts/params, server vs client) and `.../05-server-and-client-components.md` (per AGENTS.md — Next 16 differs).

## File structure
**Create:**
- `components/SiteChrome.tsx` — hides marketing Nav/Footer on `/portal`
- `app/portal/portal-theme.css` — `--pt-*` tokens per `data-portal`, light+dark
- `components/portal/PortalShell.tsx` — ink top bar + role nav + theme wrapper
- `app/portal/student/layout.tsx` — `<PortalShell role="student">`
- `app/portal/student/page.tsx` — the Profile page (server; calls `getStudentProfile`)
- `app/portal/student/lab/page.tsx`, `.../projects/page.tsx`, `.../community/page.tsx` — stubs
- `lib/portal/types.ts` — `StudentProfile` + related types
- `lib/portal/visibility.ts` — `visibleTo()` pure fn
- `lib/portal/sample.ts` — `REPRESENTATIVE_PROFILE`
- `lib/portal/student-data.ts` — `getStudentProfile()` (server: session→profile, fallback)
- `components/portal/profile/ProfileHero.tsx`, `ProfileIntro.tsx`, `PinnedProjects.tsx`, `Composer.tsx`, `ActivityFeed.tsx`
- `test/portal-visibility.test.ts`
**Modify:**
- `app/layout.tsx` — wrap children in `<SiteChrome>`
- `app/globals.css` — `@import "./portal/portal-theme.css";` (one line)

---

### Task 1: SiteChrome — drop marketing nav/footer on `/portal`

**Files:** Create `components/SiteChrome.tsx`; Modify `app/layout.tsx`

- [ ] **Step 1:** Create `components/SiteChrome.tsx`:

```tsx
"use client";

import { usePathname } from "next/navigation";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

/**
 * Renders the marketing chrome (Nav + Footer) around the page — except on
 * /portal routes, which supply their own shell. Keeps the root layout simple
 * without relocating every marketing page into a route group.
 */
export default function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPortal = pathname?.startsWith("/portal") ?? false;
  return (
    <>
      {!isPortal && <Nav />}
      <main>{children}</main>
      {!isPortal && <Footer />}
    </>
  );
}
```

- [ ] **Step 2:** In `app/layout.tsx`, replace the body content. Change:

```tsx
      <body className="font-sans antialiased">
        <Nav />
        <main>{children}</main>
        <Footer />
      </body>
```
to:
```tsx
      <body className="font-sans antialiased">
        <SiteChrome>{children}</SiteChrome>
      </body>
```
Then update the imports: remove `import Nav from "@/components/Nav";` and `import Footer from "@/components/Footer";`, add `import SiteChrome from "@/components/SiteChrome";`.

- [ ] **Step 3:** `npx tsc --noEmit && npm run lint` → clean.
- [ ] **Step 4:** Commit: `git add components/SiteChrome.tsx app/layout.tsx && git commit -m "feat(portal): hide marketing chrome on /portal via SiteChrome"`

---

### Task 2: Per-role theme tokens

**Files:** Create `app/portal/portal-theme.css`; Modify `app/globals.css`

- [ ] **Step 1:** Create `app/portal/portal-theme.css`:

```css
/* Per-role portal accent tokens. Base CurioLab cream/ink is unchanged; only the
   accent swaps by data-portal. Student is finalized; others are ready stubs. */
[data-portal] {
  --pt-accent: #3F7A54;
  --pt-accent-soft: #E6EFE6;
  --pt-accent-fg: #2C5A3D;
  --pt-accent-border: #C4DBC7;
  --pt-on-accent: #ffffff;
  --pt-chip: #9CB89C;
  --pt-banner: linear-gradient(105deg, #032344, #231E54 55%, #3F7A54);
}
[data-portal="student"] {
  --pt-accent: #3F7A54; --pt-accent-soft: #E6EFE6; --pt-accent-fg: #2C5A3D;
  --pt-accent-border: #C4DBC7; --pt-on-accent: #fff; --pt-chip: #9CB89C;
  --pt-banner: linear-gradient(105deg, #032344, #231E54 55%, #3F7A54);
}
[data-portal="parent"] {
  --pt-accent: #C56A1E; --pt-accent-soft: #FBEBD2; --pt-accent-fg: #9A5214;
  --pt-accent-border: #F1D3A6; --pt-on-accent: #fff; --pt-chip: #FBAE36;
  --pt-banner: linear-gradient(105deg, #032344, #7A3F0E 60%, #C56A1E);
}
[data-portal="mentor"] {
  --pt-accent: #143886; --pt-accent-soft: #DEEAF6; --pt-accent-fg: #143886;
  --pt-accent-border: #B9CFEA; --pt-on-accent: #fff; --pt-chip: #1CABB0;
  --pt-banner: linear-gradient(105deg, #031a3f, #143886 60%, #1CABB0);
}
[data-portal="director"] {
  --pt-accent: #C94F40; --pt-accent-soft: #F7E2DE; --pt-accent-fg: #A63A2D;
  --pt-accent-border: #EEC3BB; --pt-on-accent: #fff; --pt-chip: #E56252;
  --pt-banner: linear-gradient(105deg, #032344, #7a271c 60%, #C94F40);
}
[data-portal="admin"] {
  --pt-accent: #032344; --pt-accent-soft: #FFF3CC; --pt-accent-fg: #032344;
  --pt-accent-border: #F3DE93; --pt-on-accent: #FFCF3E; --pt-chip: #FFCF3E;
  --pt-banner: linear-gradient(105deg, #000914, #032344 55%, #B58900);
}
@media (prefers-color-scheme: dark) {
  [data-portal] { --pt-accent-soft: rgba(63,122,84,.16); --pt-accent-fg: #a9cbb0; --pt-accent-border: rgba(255,255,255,.12); }
  [data-portal="parent"] { --pt-accent-soft: rgba(197,106,30,.16); --pt-accent-fg: #f0b877; }
  [data-portal="mentor"] { --pt-accent-soft: rgba(28,171,176,.16); --pt-accent-fg: #7fc9cd; }
  [data-portal="director"] { --pt-accent-soft: rgba(201,79,64,.16); --pt-accent-fg: #f0a397; }
  [data-portal="admin"] { --pt-accent-soft: rgba(255,207,62,.16); --pt-accent-fg: #FFCF3E; }
}
```

- [ ] **Step 2:** In `app/globals.css`, add near the other imports/top (after the existing `@import`/`@theme` block — put it right after the `@theme { ... }` closes). Add the line:

```css
@import "./portal/portal-theme.css";
```

- [ ] **Step 3:** `npm run build` → compiles (Tailwind picks up the CSS). Expected: build succeeds.
- [ ] **Step 4:** Commit: `git add app/portal/portal-theme.css app/globals.css && git commit -m "feat(portal): per-role accent theme tokens"`

---

### Task 3: PortalShell

**Files:** Create `components/portal/PortalShell.tsx`

- [ ] **Step 1:** Create `components/portal/PortalShell.tsx`:

```tsx
import Link from "next/link";

export interface PortalNavItem {
  label: string;
  href: string;
}

/**
 * Shared portal chrome: an ink top bar with the CurioLab wordmark + role label,
 * role nav tabs (active tab uses the role accent), and an avatar slot. Wraps its
 * children in a data-portal themed region so every child reads --pt-* tokens.
 */
export default function PortalShell({
  role,
  roleLabel,
  nav,
  activeHref,
  avatarInitial,
  children,
}: {
  role: string;
  roleLabel: string;
  nav: PortalNavItem[];
  activeHref: string;
  avatarInitial: string;
  children: React.ReactNode;
}) {
  return (
    <div data-portal={role} className="min-h-screen bg-cream text-ink">
      <header className="bg-ink text-white">
        <div className="mx-auto max-w-5xl px-6 h-14 flex items-center justify-between gap-6">
          <div className="flex items-center gap-2.5 font-bold">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--pt-accent)" }} />
            CurioLab
            <span className="font-normal text-white/55 text-sm ml-1">{roleLabel}</span>
          </div>
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
          <div className="w-8 h-8 rounded-full grid place-items-center text-xs font-bold text-white"
               style={{ background: "var(--pt-accent)" }}>
            {avatarInitial}
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
```

- [ ] **Step 2:** `npx tsc --noEmit` → clean.
- [ ] **Step 3:** Commit: `git add components/portal/PortalShell.tsx && git commit -m "feat(portal): shared PortalShell chrome"`

---

### Task 4: Student layout + stub tabs

**Files:** Create `app/portal/student/layout.tsx`, `app/portal/student/lab/page.tsx`, `.../projects/page.tsx`, `.../community/page.tsx`

- [ ] **Step 1:** Create `app/portal/student/layout.tsx`:

```tsx
import PortalShell, { type PortalNavItem } from "@/components/portal/PortalShell";

const STUDENT_NAV: PortalNavItem[] = [
  { label: "The Lab", href: "/portal/student/lab" },
  { label: "Projects", href: "/portal/student/projects" },
  { label: "Profile", href: "/portal/student" },
  { label: "Community", href: "/portal/student/community" },
];

export default function StudentPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalShell
      role="student"
      roleLabel="Student Portal"
      nav={STUDENT_NAV}
      activeHref="/portal/student"
      avatarInitial="M"
    >
      {children}
    </PortalShell>
  );
}
```

Note: `activeHref` is static this slice (Profile is the built page); wiring the active tab to the real pathname is a later refinement.

- [ ] **Step 2:** Create the three stubs. `app/portal/student/lab/page.tsx`:

```tsx
export default function LabStub() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-16">
      <p className="label mb-3">The Lab</p>
      <h1 className="text-2xl font-bold mb-2">Coming next</h1>
      <p className="text-muted">The pod feed lands here after the Profile page.</p>
    </div>
  );
}
```

`app/portal/student/projects/page.tsx` (same shape, label "Projects", copy "Your projects — draft, submit, and track verification — land here."):

```tsx
export default function ProjectsStub() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-16">
      <p className="label mb-3">Projects</p>
      <h1 className="text-2xl font-bold mb-2">Coming next</h1>
      <p className="text-muted">Your projects — draft, submit, and track verification — land here.</p>
    </div>
  );
}
```

`app/portal/student/community/page.tsx`:

```tsx
export default function CommunityStub() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-16">
      <p className="label mb-3">Community</p>
      <h1 className="text-2xl font-bold mb-2">Coming next</h1>
      <p className="text-muted">The public community page lands here.</p>
    </div>
  );
}
```

- [ ] **Step 3:** `npx tsc --noEmit && npm run lint` → clean.
- [ ] **Step 4:** Commit: `git add app/portal/student/layout.tsx app/portal/student/lab/page.tsx app/portal/student/projects/page.tsx app/portal/student/community/page.tsx && git commit -m "feat(portal): student layout + stub tabs"`

---

### Task 5: Types + the visibility lens (TDD)

**Files:** Create `lib/portal/types.ts`, `lib/portal/visibility.ts`, `test/portal-visibility.test.ts`

- [ ] **Step 1:** Create `lib/portal/types.ts`:

```ts
export type ProjectStatus = "draft" | "submitted" | "verified" | "public_listed";
export type PostVisibility = "draft" | "community" | "newsletter";
export type Viewer = "me" | "chapter" | "link" | "public";

export interface StudentProject {
  id: string;
  title: string;
  summary: string;
  status: ProjectStatus;
  language: string | null;
  dateLabel: string;
}

export interface TimelineItem {
  id: string;
  authorName: string;
  dateLabel: string;
  visibility: PostVisibility;
  body: string;
  usefulCount: number;
  commentCount: number;
  attachedProject: { title: string; note: string } | null;
  nomination: { by: string; note: string } | null;
  isDraft: boolean;
}

export interface StudentProfile {
  subjectAccountId: string;
  displayName: string;
  initial: string;
  tier: string | null;
  chapterName: string;
  joinedLabel: string;
  verified: boolean;
  stats: { verifiedProjects: number; sessions: number; inNewsletter: number; tier: string };
  narrative: { body: string; status: "published" | "pending_review" } | null;
  skills: string[];
  projects: StudentProject[];
  timeline: TimelineItem[];
  isSample: boolean;
}
```

- [ ] **Step 2:** Write the failing test `test/portal-visibility.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { visibleTo } from "@/lib/portal/visibility";
import type { Viewer } from "@/lib/portal/types";

describe("visibleTo", () => {
  it("shows drafts only to me", () => {
    expect(visibleTo("draft", "me")).toBe(true);
    (["chapter", "link", "public"] as Viewer[]).forEach((v) =>
      expect(visibleTo("draft", v)).toBe(false),
    );
  });
  it("shows community to me and chapter only", () => {
    expect(visibleTo("community", "me")).toBe(true);
    expect(visibleTo("community", "chapter")).toBe(true);
    expect(visibleTo("community", "link")).toBe(false);
    expect(visibleTo("community", "public")).toBe(false);
  });
  it("shows newsletter to everyone", () => {
    (["me", "chapter", "link", "public"] as Viewer[]).forEach((v) =>
      expect(visibleTo("newsletter", v)).toBe(true),
    );
  });
});
```

- [ ] **Step 3:** Run: `npm run test:web -- test/portal-visibility.test.ts` → FAIL (module not found).

- [ ] **Step 4:** Create `lib/portal/visibility.ts`:

```ts
import type { PostVisibility, Viewer } from "./types";

const RULES: Record<Viewer, PostVisibility[]> = {
  me: ["draft", "community", "newsletter"],
  chapter: ["community", "newsletter"],
  link: ["newsletter"],
  public: ["newsletter"],
};

/** Preview of what each audience sees — mirrors the platform visibility model. */
export function visibleTo(visibility: PostVisibility, viewer: Viewer): boolean {
  return RULES[viewer].includes(visibility);
}
```

- [ ] **Step 5:** Run: `npm run test:web -- test/portal-visibility.test.ts` → PASS (3 tests).
- [ ] **Step 6:** Commit: `git add lib/portal/types.ts lib/portal/visibility.ts test/portal-visibility.test.ts && git commit -m "feat(portal): student profile types + visibility lens (tested)"`

---

### Task 6: Representative sample + data seam

**Files:** Create `lib/portal/sample.ts`, `lib/portal/student-data.ts`

- [ ] **Step 1:** Create `lib/portal/sample.ts` (obviously-synthetic; drawn from the reference):

```ts
import type { StudentProfile } from "./types";

export const REPRESENTATIVE_PROFILE: StudentProfile = {
  subjectAccountId: "sample",
  displayName: "Maya R.",
  initial: "M",
  tier: "Builder",
  chapterName: "CWRU Chapter",
  joinedLabel: "Joined Oct 2025",
  verified: true,
  stats: { verifiedProjects: 4, sessions: 11, inNewsletter: 2, tier: "Builder" },
  narrative: {
    status: "pending_review",
    body: "I build things that move on screen. Started with p5.js sketches, now I'm working through physics simulation and how game engines resolve collisions. Next I want to write a 2D engine from scratch instead of using a library.",
  },
  skills: ["p5.js", "JavaScript", "Physics sim", "Canvas"],
  projects: [
    { id: "p1", title: "orbit-simulator", summary: "Two-body gravity sim with adjustable mass and velocity. Trails render on a decay buffer.", status: "verified", language: "JavaScript · p5.js", dateLabel: "Mar 4" },
    { id: "p2", title: "maze-generator", summary: "Recursive backtracker with a step-through visualizer so you can watch it carve.", status: "verified", language: "JavaScript", dateLabel: "Feb 24" },
    { id: "p3", title: "sorting-visualizer", summary: "Six sort algorithms racing side by side with comparison counters.", status: "verified", language: "JavaScript", dateLabel: "Jan 20" },
    { id: "p4", title: "reaction-game", summary: "Reaction-time tester that logs your times and plots the distribution.", status: "submitted", language: "JavaScript", dateLabel: "submitted Mar 18" },
  ],
  timeline: [
    { id: "t1", authorName: "Maya R.", dateLabel: "Edited yesterday", visibility: "draft", body: "Notes on numerical integration drift, half written. Euler accumulates error fast — test Verlet before posting.", usefulCount: 0, commentCount: 0, attachedProject: null, nomination: null, isDraft: true },
    { id: "t2", authorName: "Maya R.", dateLabel: "2 days ago", visibility: "community", body: "Collision detection finally works. The bug was checking overlap after moving the sprite instead of before, so anything fast enough tunneled straight through walls. Sweeping the position between frames fixed it.", usefulCount: 7, commentCount: 2, attachedProject: { title: "orbit-simulator", note: "Verified project · updated Mar 20" }, nomination: { by: "Dev K.", note: "Nominated this for the March newsletter. If it runs, it goes on the public community page and can be found by search. Your call." }, isDraft: false },
    { id: "t3", authorName: "Maya R.", dateLabel: "Mar 4 · March newsletter", visibility: "newsletter", body: "Orbit Simulator got verified today, which moves me to Builder. Writing up what I learned about numerical integration for the next cohort — the naive version drifts badly and nobody told me why.", usefulCount: 21, commentCount: 6, attachedProject: null, nomination: null, isDraft: false },
    { id: "t4", authorName: "Maya R.", dateLabel: "Feb 26", visibility: "community", body: "Stuck on the maze generator — my recursive backtracker blows the stack on grids bigger than 60x60. Explicit stack, or am I missing something structural?", usefulCount: 4, commentCount: 9, attachedProject: null, nomination: null, isDraft: false },
    { id: "t5", authorName: "Maya R.", dateLabel: "Jan 20 · January newsletter", visibility: "newsletter", body: "Six sorting algorithms racing side by side. Watching bubble sort lose to quicksort on 500 elements taught me more about complexity than the big-O table did.", usefulCount: 33, commentCount: 11, attachedProject: null, nomination: null, isDraft: false },
  ],
  isSample: true,
};
```

- [ ] **Step 2:** Create `lib/portal/student-data.ts`:

```ts
import { cookies, headers } from "next/headers";
import type { StudentProfile, StudentProject, ProjectStatus } from "./types";
import { REPRESENTATIVE_PROFILE } from "./sample";

interface ApiProject { projectId?: string; title?: string; summary?: string | null; status?: string }
interface ApiProfile {
  subjectAccountId?: string; displayName?: string; tier?: string | null;
  membership?: { chapterName?: string } | null; projects?: ApiProject[]; mentorHours?: number;
  narrative?: { body?: string; status?: string } | null;
}

function mapStatus(s: string | undefined): ProjectStatus {
  return s === "verified" || s === "submitted" || s === "public_listed" ? s : "draft";
}

/** Map the GET /api/profile/:id response into the presentational model. Fields the
 *  API does not carry (per-post visibility, session/newsletter counts) default to
 *  honest zero-states — the feed then shows its empty state for a real new student. */
function mapProfile(p: ApiProfile): StudentProfile {
  const name = p.displayName ?? "Student";
  const projects: StudentProject[] = (p.projects ?? []).map((pr, i) => ({
    id: pr.projectId ?? `p${i}`,
    title: pr.title ?? "Untitled project",
    summary: pr.summary ?? "",
    status: mapStatus(pr.status),
    language: null,
    dateLabel: "",
  }));
  const verifiedCount = projects.filter((pr) => pr.status === "verified" || pr.status === "public_listed").length;
  return {
    subjectAccountId: p.subjectAccountId ?? "",
    displayName: name,
    initial: name.trim().charAt(0).toUpperCase() || "?",
    tier: p.tier ?? null,
    chapterName: p.membership?.chapterName ?? "",
    joinedLabel: "",
    verified: verifiedCount > 0,
    stats: { verifiedProjects: verifiedCount, sessions: 0, inNewsletter: 0, tier: p.tier ?? "—" },
    narrative: p.narrative?.body
      ? { body: p.narrative.body, status: p.narrative.status === "published" ? "published" : "pending_review" }
      : null,
    skills: [],
    projects,
    timeline: [],
    isSample: false,
  };
}

/** Read the live session (cl_session) → profile; fall back to representative data. */
export async function getStudentProfile(): Promise<StudentProfile> {
  try {
    const session = (await cookies()).get("cl_session");
    if (!session) return REPRESENTATIVE_PROFILE;
    const host = (await headers()).get("host");
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? (host ? `http://${host}` : "");
    if (!origin) return REPRESENTATIVE_PROFILE;
    const cookie = `cl_session=${session.value}`;

    const sres = await fetch(`${origin}/api/auth/session`, { headers: { cookie }, cache: "no-store" });
    if (!sres.ok) return REPRESENTATIVE_PROFILE;
    const s = (await sres.json()) as { accountId?: string; memberships?: { role?: string }[] };
    const isStudent = (s.memberships ?? []).some((m) => m.role === "student" || m.role === "alumni");
    if (!s.accountId || !isStudent) return REPRESENTATIVE_PROFILE;

    const pres = await fetch(`${origin}/api/profile/${s.accountId}`, { headers: { cookie }, cache: "no-store" });
    if (!pres.ok) return REPRESENTATIVE_PROFILE;
    return mapProfile((await pres.json()) as ApiProfile);
  } catch {
    return REPRESENTATIVE_PROFILE;
  }
}
```

- [ ] **Step 3:** `npx tsc --noEmit` → clean.
- [ ] **Step 4:** Commit: `git add lib/portal/sample.ts lib/portal/student-data.ts && git commit -m "feat(portal): student profile data seam with representative fallback"`

---

### Task 7: Profile presentational components

**Files:** Create `components/portal/profile/ProfileHero.tsx`, `ProfileIntro.tsx`, `PinnedProjects.tsx`, `Composer.tsx`, `ActivityFeed.tsx`

- [ ] **Step 1:** `components/portal/profile/ProfileHero.tsx`:

```tsx
import type { StudentProfile } from "@/lib/portal/types";

export default function ProfileHero({ p }: { p: StudentProfile }) {
  const stats = [
    { v: p.stats.verifiedProjects, s: "Verified projects" },
    { v: p.stats.sessions, s: "Sessions attended" },
    { v: p.stats.inNewsletter, s: "In the newsletter" },
    { v: p.stats.tier, s: "Current tier" },
  ];
  return (
    <div className="bg-white border border-black/10 rounded-xl overflow-hidden">
      <div className="h-[70px]" style={{ background: "var(--pt-banner)" }} />
      <div className="px-6 pb-5 -mt-7 flex gap-4 items-end flex-wrap">
        <div className="w-[70px] h-[70px] rounded-xl border-[3px] border-white grid place-items-center text-white text-2xl font-semibold"
             style={{ background: "var(--pt-accent)" }}>{p.initial}</div>
        <div className="flex-1 min-w-[180px]">
          <h1 className="text-2xl font-bold tracking-tight">{p.displayName}</h1>
          <div className="text-muted text-sm">{[p.tier, p.chapterName, p.joinedLabel].filter(Boolean).join(" · ")}</div>
        </div>
        <div className="flex items-center gap-2">
          {p.verified && (
            <span className="label" style={{ color: "var(--pt-accent-fg)", background: "var(--pt-accent-soft)", border: "1px solid var(--pt-accent-border)", padding: "3px 8px", borderRadius: "999px" }}>
              CurioLab verified
            </span>
          )}
          <button className="text-sm font-medium px-3 py-1.5 rounded-md border border-black/15 hover:bg-black/[.03]">Share profile</button>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 border-t border-black/[.06]">
        {stats.map((st, i) => (
          <div key={i} className="px-5 py-3 border-r border-black/[.06] last:border-r-0">
            <div className="font-mono text-lg">{st.v}</div>
            <div className="text-xs text-muted">{st.s}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2:** `components/portal/profile/ProfileIntro.tsx`:

```tsx
import type { StudentProfile } from "@/lib/portal/types";

export default function ProfileIntro({ p }: { p: StudentProfile }) {
  if (!p.narrative && p.skills.length === 0) {
    return (
      <div className="bg-white border border-black/10 rounded-xl p-5">
        <div className="label mb-2">Intro</div>
        <p className="text-muted text-sm">No intro yet — write a line about what you build.</p>
      </div>
    );
  }
  return (
    <div className="bg-white border border-black/10 rounded-xl p-5">
      <div className="flex items-center justify-between mb-2">
        <div className="label">Intro</div>
        {p.narrative?.status === "pending_review" && (
          <span className="label" style={{ color: "#8A5B00", background: "#FFF4E0", border: "1px solid #F5DFB0", padding: "3px 8px", borderRadius: "999px" }}>Edit in review</span>
        )}
      </div>
      {p.narrative && <p className="text-[15px]">{p.narrative.body}</p>}
      {p.skills.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-black/[.06]">
          {p.skills.map((s) => (
            <span key={s} className="text-xs px-2.5 py-1 rounded-full border border-black/15 text-muted">{s}</span>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3:** `components/portal/profile/PinnedProjects.tsx`:

```tsx
import type { StudentProfile } from "@/lib/portal/types";

export default function PinnedProjects({ p }: { p: StudentProfile }) {
  if (p.projects.length === 0) {
    return (
      <div className="bg-white border border-black/10 rounded-xl p-5">
        <div className="label mb-2">Pinned projects</div>
        <p className="text-muted text-sm">Your verified projects will show here.</p>
      </div>
    );
  }
  return (
    <div className="bg-white border border-black/10 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="label">Pinned projects</div>
        <button className="text-xs font-medium px-2.5 py-1 rounded-md border border-black/15 hover:bg-black/[.03]">Choose pins</button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {p.projects.map((pr) => {
          const verified = pr.status === "verified" || pr.status === "public_listed";
          return (
            <div key={pr.id} className="border border-black/10 rounded-lg p-3.5">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-[14.5px] font-semibold">{pr.title}</h4>
                <span className="label" style={verified
                  ? { color: "var(--pt-accent-fg)", background: "var(--pt-accent-soft)", border: "1px solid var(--pt-accent-border)", padding: "2px 8px", borderRadius: "999px" }
                  : { color: "#8A5B00", background: "#FFF4E0", border: "1px solid #F5DFB0", padding: "2px 8px", borderRadius: "999px" }}>
                  {verified ? "Verified" : "In review"}
                </span>
              </div>
              <p className="text-[13px] text-muted my-2 min-h-[34px]">{pr.summary}</p>
              <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
                <span className="w-2 h-2 rounded-full" style={{ background: "var(--pt-chip)" }} />
                {[pr.language, pr.dateLabel].filter(Boolean).join(" · ")}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4:** `components/portal/profile/Composer.tsx` (`"use client"` — destination toggle + newsletter):

```tsx
"use client";

import { useState } from "react";
import type { StudentProfile } from "@/lib/portal/types";

export default function Composer({ p }: { p: StudentProfile }) {
  const [dest, setDest] = useState<"draft" | "community">("community");
  const note = dest === "draft"
    ? "Only you can open this. Mentors can't see drafts."
    : "Everyone signed in to CurioLab can read this. It stays off the public site.";
  return (
    <div className="bg-white border border-black/10 rounded-xl p-5">
      <div className="label mb-2.5">Post an update</div>
      <textarea
        className="w-full border border-black/15 rounded-lg p-3 min-h-[70px] resize-y text-[15px]"
        placeholder="What did you get working? What broke?"
      />
      <div className="flex gap-2 mt-3 flex-wrap">
        {(["draft", "community"] as const).map((d) => {
          const on = dest === d;
          return (
            <button
              key={d}
              type="button"
              onClick={() => setDest(d)}
              className="px-3 py-2 rounded-lg text-sm font-medium border"
              style={on
                ? { color: "var(--pt-accent-fg)", background: "var(--pt-accent-soft)", borderColor: "var(--pt-accent-border)" }
                : { color: "var(--color-muted)", background: "#fff", borderColor: "rgba(0,0,0,.12)" }}
            >
              {d === "draft" ? "Save as draft" : "Post to community"}
            </button>
          );
        })}
      </div>
      <div className="text-[13px] text-muted mt-2.5">{note}</div>
      {dest === "community" && (
        <label className="flex gap-2.5 items-start mt-3 pt-3 border-t border-black/[.06]">
          <input type="checkbox" className="mt-0.5 w-4 h-4" style={{ accentColor: "var(--pt-accent)" }} />
          <span>
            <span className="text-[13.5px]">Also submit to the newsletter</span>
            <span className="block text-[12.5px] text-muted mt-0.5">A mentor reviews it first. If it runs, it goes on the public community page and can be found by search.</span>
          </span>
        </label>
      )}
      <div className="flex items-center justify-between gap-3 mt-3.5 flex-wrap">
        <span className="text-[13px] text-muted">Posting as <b className="text-ink">{p.displayName}</b> · under 18, so last name and school stay hidden</span>
        <button className="px-3.5 py-2 rounded-md text-sm font-medium text-[color:var(--pt-on-accent)]" style={{ background: "var(--pt-accent)" }}>
          {dest === "draft" ? "Save draft" : "Post to community"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5:** `components/portal/profile/ActivityFeed.tsx` (`"use client"` — the lens):

```tsx
"use client";

import { useState } from "react";
import { visibleTo } from "@/lib/portal/visibility";
import type { StudentProfile, TimelineItem, Viewer } from "@/lib/portal/types";

const VIEWERS: { key: Viewer; label: string }[] = [
  { key: "me", label: "Me" },
  { key: "chapter", label: "Chapter" },
  { key: "link", label: "Someone with my link" },
  { key: "public", label: "Public" },
];
const LENS_NOTE: Record<Viewer, string> = {
  me: "Your own view. Drafts included.",
  chapter: "What a chapter member or mentor sees. Drafts are gone.",
  link: "What a teacher or program you sent your link to sees. Newsletter posts only.",
  public: "What anyone on curiolab.org sees. Newsletter posts only.",
};
const BADGE: Record<TimelineItem["visibility"], { t: string; c: string; bg: string; bd: string }> = {
  draft: { t: "Draft", c: "var(--color-muted)", bg: "var(--color-ivory)", bd: "rgba(0,0,0,.1)" },
  community: { t: "Community", c: "var(--pt-accent-fg)", bg: "var(--pt-accent-soft)", bd: "var(--pt-accent-border)" },
  newsletter: { t: "Newsletter", c: "#1B6E3A", bg: "#E7F5EC", bd: "#BFE3CC" },
};

export default function ActivityFeed({ p }: { p: StudentProfile }) {
  const [viewer, setViewer] = useState<Viewer>("me");
  const shown = p.timeline.filter((i) => visibleTo(i.visibility, viewer));
  return (
    <div>
      <div className="label mb-2.5">Activity</div>
      <div className="flex items-center gap-3 bg-white border border-black/10 rounded-lg px-3 py-2.5 mb-3 flex-wrap">
        <span className="label">Viewing as</span>
        <div className="flex border border-black/10 rounded-md overflow-hidden">
          {VIEWERS.map((v) => {
            const on = viewer === v.key;
            return (
              <button key={v.key} type="button" onClick={() => setViewer(v.key)}
                className="px-2.5 py-1.5 text-[12.5px] border-r border-black/10 last:border-r-0"
                style={on ? { background: "var(--color-ink)", color: "#fff", fontWeight: 500 } : { background: "#fff", color: "var(--color-muted)" }}>
                {v.label}
              </button>
            );
          })}
        </div>
        <span className="text-[12.5px] text-muted flex-1 min-w-[200px]">{LENS_NOTE[viewer]}</span>
      </div>

      {shown.length === 0 ? (
        <div className="border border-dashed border-black/15 rounded-xl p-6 text-center text-muted text-[13.5px]">Nothing here for this viewer yet.</div>
      ) : (
        shown.map((i) => {
          const b = BADGE[i.visibility];
          return (
            <div key={i.id} className="bg-white border border-black/10 rounded-xl p-4 mb-2.5" style={i.isDraft ? { borderStyle: "dashed" } : undefined}>
              <div className="flex justify-between gap-2.5 items-start">
                <div>
                  <h4 className="text-sm font-semibold">{i.authorName}</h4>
                  <div className="font-mono text-[11px] text-muted">{i.dateLabel}</div>
                </div>
                <span className="label" style={{ color: b.c, background: b.bg, border: `1px solid ${b.bd}`, padding: "2px 8px", borderRadius: "999px" }}>{b.t}</span>
              </div>
              <p className="text-[14.5px] mt-2">{i.body}</p>
              {i.attachedProject && (
                <div className="mt-3 border border-black/10 rounded-lg flex items-center gap-3 px-3 py-2.5 bg-cream">
                  <span className="w-11 h-8 rounded-md" style={{ background: "linear-gradient(135deg,#0B3A63,#231E54)" }} />
                  <span><b className="text-[13.5px]">{i.attachedProject.title}</b><span className="block text-muted text-[12px]">{i.attachedProject.note}</span></span>
                </div>
              )}
              {i.nomination && (
                <div className="mt-3 rounded-lg px-3 py-2.5 text-[13px]" style={{ background: "#FFF9EC", border: "1px solid #F5DFB0", color: "#6B4A08" }}>
                  <b className="block mb-1" style={{ color: "#5A3D06" }}>{i.nomination.by} nominated this for the newsletter</b>
                  {i.nomination.note}
                  <div className="flex gap-2 mt-2.5 flex-wrap">
                    <button className="text-xs font-medium px-2.5 py-1 rounded-md text-[color:var(--pt-on-accent)]" style={{ background: "var(--pt-accent)" }}>Accept</button>
                    <button className="text-xs font-medium px-2.5 py-1 rounded-md border border-black/15">No thanks</button>
                    <button className="text-xs font-medium px-2.5 py-1 rounded-md border border-black/15">Run it without my name</button>
                  </div>
                </div>
              )}
              <div className="flex gap-1.5 border-t border-black/[.06] mt-3 pt-2.5 text-[12.5px] text-muted">
                {i.isDraft ? (
                  <><button className="px-2 py-1 rounded-full hover:bg-black/[.04]">Continue writing</button><button className="px-2 py-1 rounded-full hover:bg-black/[.04]">Delete</button></>
                ) : (
                  <><button className="px-2 py-1 rounded-full hover:bg-black/[.04]">▲ Useful · {i.usefulCount}</button><button className="px-2 py-1 rounded-full hover:bg-black/[.04]">Comment · {i.commentCount}</button></>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
```

- [ ] **Step 6:** `npx tsc --noEmit && npm run lint` → clean (watch `react/no-unescaped-entities`: apostrophes in JSX text like "can't" must be `can&apos;t`; the strings above that live in JS (note/LENS_NOTE constants) are fine, but any apostrophe in JSX *text* must be escaped — fix if lint flags).
- [ ] **Step 7:** Commit: `git add components/portal/profile/ && git commit -m "feat(portal): profile hero, intro, projects, composer, activity feed"`

---

### Task 8: The Profile page

**Files:** Create `app/portal/student/page.tsx`

- [ ] **Step 1:** Create `app/portal/student/page.tsx` (server component — composes the seam + components):

```tsx
import { getStudentProfile } from "@/lib/portal/student-data";
import ProfileHero from "@/components/portal/profile/ProfileHero";
import ProfileIntro from "@/components/portal/profile/ProfileIntro";
import PinnedProjects from "@/components/portal/profile/PinnedProjects";
import Composer from "@/components/portal/profile/Composer";
import ActivityFeed from "@/components/portal/profile/ActivityFeed";

export default async function StudentProfilePage() {
  const p = await getStudentProfile();
  return (
    <div className="mx-auto max-w-3xl px-6 py-6 pb-20 space-y-3.5">
      {p.isSample && (
        <div className="text-xs font-mono text-muted border border-dashed border-black/15 rounded-md px-3 py-2">
          Sample data — sign in as a student to see a real profile.
        </div>
      )}
      <ProfileHero p={p} />
      <ProfileIntro p={p} />
      <PinnedProjects p={p} />
      <Composer p={p} />
      <div className="pt-4">
        <ActivityFeed p={p} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2:** `npx tsc --noEmit && npm run lint` → clean.
- [ ] **Step 3:** Commit: `git add app/portal/student/page.tsx && git commit -m "feat(portal): student profile page"`

---

### Task 9: Verification

- [ ] **Step 1:** `npm run test:web` → all tests pass (visibility + prior funnel tests).
- [ ] **Step 2:** `npx tsc --noEmit && npm run lint && npm run build` → clean; the build output lists `/portal/student`, `/portal/student/lab`, `/portal/student/projects`, `/portal/student/community`.
- [ ] **Step 3:** Manual check with the running dev server (or `npm run dev`): open `http://localhost:3000/portal/student` — the green-themed profile renders (sample-data banner shown, since no student session), the "Viewing as" lens filters posts (Me shows the draft; Public shows only newsletter posts), the composer draft/community toggle swaps the note + newsletter row. Open `http://localhost:3000/` — the marketing Nav/Footer are back. Confirm `/portal/student` has **no** marketing nav/footer.
- [ ] **Step 4:** `git status --short packages/` → empty (no package files touched).

---

## Self-review notes (author)
- **Spec coverage:** SiteChrome (T1), theme tokens incl. all 5 roles (T2), PortalShell (T3), student layout + stubs (T4), types + lens tested (T5), data seam with fallback (T6), all five profile sections incl. composer privacy line + "viewing as" lens (T7), page with sample affordance (T8), verification incl. chrome check (T9).
- **Types:** `StudentProfile`/`TimelineItem`/`Viewer`/`ProjectStatus`/`PostVisibility` defined once in T5; every component (T7) and the seam (T6) import them.
- **Non-goals honored:** no writes wired, other tabs stubbed, no login page, no `packages/*` edits.
- **Deferred refinement noted:** `activeHref` static in T4 (active tab follows real pathname later).
