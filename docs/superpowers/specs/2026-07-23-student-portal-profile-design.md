# Student portal — Profile page + portal shell design

Date: 2026-07-23
Status: approved design, pre-implementation
Related: `docs/platform/api-reference.md` §2 (auth), §4 (profile/projects), §5 (The Lab); the portals prototype; the user's profile-page reference

## Goal

Ship the first slice of the student portal: the **Profile page** (matching the user's reference — hero, pinned projects, intro/narrative, composer, activity feed with a "viewing as" lens), inside a **reusable portal shell** with a **per-role theme system** (student = green now; parent/mentor/director/admin plug in later). Rendered from a data seam that reads real data when a session exists and falls back to representative data otherwise.

## Non-goals (this slice)

- The login page and the multi-portal "which portal?" switcher (next slice — routing mapping recorded below).
- Backend writes: posting, narrative edit, project create, share, verification-token — buttons are present but visual only for now.
- The Lab / Projects / Community tabs — navigable **stubs** under the shell.
- Any change to `packages/*` — this is purely web-app (`app/`, `components/`, `lib/`).

## Architecture & routing

- **Routes** under a literal `/portal` segment:
  - `app/portal/student/page.tsx` — the Profile (portal home) **[built in full]**
  - `app/portal/student/lab/page.tsx`, `.../projects/page.tsx`, `.../community/page.tsx` — **stubs**
- **`components/portal/PortalShell.tsx`** — the shared chrome: ink top bar (brand + role label), role nav tabs, avatar/switcher slot, and a `data-portal` theme wrapper. Takes `role` + `nav` + `children`.
- **`app/portal/student/layout.tsx`** — a thin layout: `<PortalShell role="student" nav={STUDENT_NAV}>`. Each future role adds its own equivalent layout; no rework to the shell.
- **Marketing-chrome hiding:** the root `app/layout.tsx` currently hardcodes `<Nav/>{children}<Footer/>`. Wrap them in a new client `components/SiteChrome.tsx` that uses `usePathname()` and renders `<Nav/>`/`<Footer/>` only when the path does **not** start with `/portal`. Root layout becomes `<body><SiteChrome>{children}</SiteChrome></body>`. Low-risk; no marketing pages move.

## Per-role theme system

A `data-portal="<role>"` attribute on the shell root sets accent tokens that every portal component reads; the CurioLab cream/ink base is unchanged, only the accent swaps. Tokens (defined once in `app/portal/portal-theme.css`, imported by the shell):

- `--pt-accent` (strong, button-grade), `--pt-accent-soft` (tint bg), `--pt-accent-fg` (text on tint), `--pt-accent-border`, `--pt-banner` (hero gradient), `--pt-on-accent` (text on the solid accent).

| `data-portal` | accent family | `--pt-accent` / `--pt-accent-soft` |
|---|---|---|
| `student` *(now)* | green | `#3F7A54` / `#E6EFE6` (sage `#9CB89C` for chips) |
| `parent` | orange | `#C56A1E` / `#FBEBD2` (marigold/terracotta) |
| `mentor` | blue | `#143886` / `#DEEAF6` (teal `#1CABB0`) |
| `director` | red | `#C94F40` / `#F7E2DE` (coral) |
| `admin` | black+yellow | `#032344` / `#FFF3CC` (butteryellow `#FFCF3E`) |

Both light and dark themes defined at the token level (the site is light-first; dark tokens keep the accent legible). Only `student` values must be finalized this slice; the rest are stubbed in the same file so later portals are a table edit.

## The Profile page

CurioLab design system: Nunito Sans (body), JetBrains-mono labels/eyebrows, cream/ink base, green accent. Composed of presentational components under `components/portal/profile/`, each taking typed props:

- **`ProfileHero`** — banner (`--pt-banner` gradient), avatar (initial), name · tier · chapter · joined date, "CurioLab verified" tag, "Share profile" button; **stat strip** (verified projects, sessions, in-newsletter, current tier).
- **`ProfileIntro`** — narrative body, an "Edit in review" tag when `narrative.status === 'pending_review'`, skill chips.
- **`PinnedProjects`** — grid of project cards; each shows title, summary, a `Verified` / `In review` tag, and a language·date line.
- **`Composer`** — textarea; destination toggle **Draft ↔ Post to community**; an "Also submit to the newsletter" checkbox (shown only for community) with the mentor-review note; a post button whose label tracks the destination; and the privacy line: *"Posting as Maya R. · under 18, so last name and school stay hidden."* Visual only this slice (no POST).
- **`ActivityFeed`** + **`ViewerLens`** — the "Viewing as" control (Me / Chapter / Link / Public) filters posts by each item's `visibility`; posts render a destination badge (Draft / Community / Newsletter), useful/comment/edit actions, and an optional newsletter-nomination card. The lens is a **real client interaction**; an empty-state shows when a viewer sees nothing.

## Data seam

`lib/portal/student-data.ts`:

- A typed **`StudentProfile`** model mirroring `GET /api/profile/:id` (`displayName`, `tier`, `membership`, `projects[]`, `timeline[]`, `mentorHours`, `narrative`), extended with the presentational fields the reference needs (`visibility` on timeline items: `'draft' | 'community' | 'newsletter'`; project `status`).
- **`getStudentProfile()`** (server-side): read the `cl_session` cookie → `GET /api/auth/session` for the actor `accountId` and confirm a `student` (or `alumni`) membership → `GET /api/profile/:accountId`; map the response into `StudentProfile`. On **no session / any fetch failure**, return `REPRESENTATIVE_PROFILE` (obviously-synthetic sample data) so the page always renders. Cookie forwarding uses `next/headers` `cookies()`; origin from `headers()`/`NEXT_PUBLIC_SITE_URL`.
- Result: viewable now (fallback); real data automatically once a student can log in — no code change.

## Portal routing (recorded for the next slice, not built now)

After `POST /api/auth/login` + `GET /api/auth/session`, route by: **Parent** = `guardianOf.length > 0`; **Student** = a membership `role` in `student`/`alumni`; **Mentor** = `junior_mentor`/`senior_instructor`/`lead_instructor`; **Director** = `chapter_director`; **Admin** = `platform_admin`/`platform_staff`. One account can match several → show a "which portal?" switcher; exactly one → land directly.

## The "viewing as" lens — semantics

Maps to the platform's visibility model as a **preview** (not an authorization decision, which the backend owns):
- **Me** — everything, drafts included.
- **Chapter** — community + newsletter posts (drafts gone).
- **Someone with my link** — newsletter posts only (the verification-link audience).
- **Public** — newsletter posts only (what curiolab.org shows).

`visibleTo(item, viewer)` is a pure function: `item.visibility` ∈ {draft, community, newsletter} × viewer → boolean, per the table above. Unit-tested.

## Testing

- Types compile (`tsc`).
- **Unit test** `visibleTo()` (pure): drafts only to Me; community to Me/Chapter; newsletter to all four; empty-state when nothing matches.
- `npm run lint` and `npm run build` green; `/portal/student` and stubs appear in the build; marketing Nav/Footer absent on `/portal`, present elsewhere.

## Risks

- **Shared branch** — keep everything additive; no `packages/*` edits; stage per-file.
- **Green legibility** — `--pt-accent #3F7A54` (not light sage) for button/active contrast; sage reserved for decorative chips.
- **Fallback honesty** — representative data is obviously synthetic and a small "sample data" affordance appears when the fallback is used, so it's never mistaken for a real student's record.
