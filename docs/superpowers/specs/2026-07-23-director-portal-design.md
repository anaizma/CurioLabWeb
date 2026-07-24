# Director portal — design

Date: 2026-07-23
Status: approved design, pre-implementation
Related: `docs/platform/api-reference.md` §1 (auth/session), §2 (invites), §6 (ops); `docs/platform/director-portal-read-endpoints.md` (the backend GETs this portal needs); the student-portal spec `2026-07-23-student-portal-profile-design.md` (shell + theme system this reuses)

## Goal

Build the **Chapter Director portal** (`/portal/director/*`, red theme) — the chapter's operational back office. It covers the whole director surface: a dashboard, applications review, the **invite → account flow** (director issues invites that let recipients create accounts landing in their designated portal type), member roster, guardianships, safety/moderation, deletion/export requests, pods/terms, content/newsletter, and the audit log.

It reuses the portal foundation already shipped for the student portal (`PortalShell`, `data-portal` theme tokens, `SiteChrome`, the `cl_session` → session → resource data-seam pattern). Every surface renders **now** from a data seam that reads live data where a backend GET exists and falls back to clearly-marked representative data (`isSample`) otherwise — so the portal is viewable and demoable today and flips to real data per surface as each backend GET lands, with no frontend rework.

## Invite model (decided) — guardian-mediated

The director issues invites of kind **guardian / mentor / staff** only. **Students are never invited directly**; a student account is created by the student's guardian from the (future) guardian portal via the username path. This matches the backend: `POST /api/ops/invites` accepts `kind ∈ {guardian, student, mentor, staff}`, but our director UI exposes only guardian/mentor/staff. The public `accept-student` (username) page is still built so the guardian-mediated student path works end-to-end the moment a guardian issues that invite.

**How an invite becomes a portal account:**

1. Director issues an invite (`POST /api/ops/invites`) → gets `{ inviteId, token, expiresAt }`. The UI shows the shareable link `<origin>/invite/<token>` (copy) + expiry. The raw token is returned **once**.
2. Recipient opens `/invite/<token>` → `GET /api/invites/<token>` validates it and returns `{ usable, kind, chapter }`.
3. Recipient submits the accept form → `POST /api/invites/<token>/accept` (email path: guardian/mentor/staff) or `/accept-student` (username path: student). This creates a **`pending`** account (and a `pending` guardianship edge for a guardian invite). It is inert — no live access yet.
4. A director activates the resulting membership (`POST /api/ops/memberships/<id>/activate`) → the account moves `pending → active`.
5. The recipient signs in (`POST /api/auth/login`) and is routed to their portal by the session→portal mapping (recorded in the student-portal spec: guardian→parent, mentor roles→mentor, `chapter_director`→director, etc.). **Kind → membership role → portal** is how "the invite lands them in their designated portal type" is realized.

## Non-goals (this design)

- No `packages/*` edits — purely web-app (`app/`, `components/`, `lib/`). The backend GETs this portal wants are **specified for the backend agent**, not implemented here (see `director-portal-read-endpoints.md`).
- The login page + multi-portal switcher is a separate slice (already recorded in the student-portal spec) — it closes step 4→5 above. This portal assumes a director is already authenticated for its own reads.
- Ops **write** actions are wired to their existing POST/PATCH where safe and unambiguous (invite issue/resend, application transition, membership activate, guardianship verify/revoke, deletion/export review/fulfill, media review, pods/terms, newsletter, narrative/project review). Where a write depends on data only a not-yet-built GET can supply an id for, the control is present but visual until that GET lands — flagged per surface in the plan.
- No real minors' data anywhere in fallback content — representative data is obviously synthetic.

## Architecture & routing

Routes under `/portal/director/*`:

- `app/portal/director/layout.tsx` — renders `<PortalShell role="director" roleLabel="Chapter Director" sidebar={DIRECTOR_NAV} …>`.
- `app/portal/director/page.tsx` — **Dashboard** (portal home).
- One page per surface: `applications/`, `applications/[id]/`, `invites/`, `enrollments/`, `members/`, `guardianships/`, `moderation/`, `media/`, `requests/`, `pods/`, `content/`, `audit/`.
- **Public accept pages** (outside the portal): `app/invite/[token]/page.tsx` + a client accept form. `SiteChrome` hides the marketing Nav/Footer on `/invite` as well as `/portal`, so onboarding is a focused card.

### PortalShell gets an optional sidebar

The student portal has 4 top-nav tabs; the director has ~10 surfaces grouped into sections, which is a sidebar pattern. `PortalShell` is extended with an **optional** `sidebar?: PortalNavGroup[]` prop:

- When `sidebar` is omitted → today's behavior exactly (top-bar `nav`, student unaffected).
- When `sidebar` is provided → the top bar keeps brand + role label + avatar (top-bar `nav` suppressed), and a two-column `[sidebar | content]` region renders below it. The sidebar lists grouped links; the active link (matched by `activeHref`) uses `var(--pt-accent)`.

```ts
export interface PortalNavItem { label: string; href: string; }
export interface PortalNavGroup { title: string; items: PortalNavItem[]; }
```

This is additive and reusable — the mentor/admin portals (also ops-ish) can adopt the same sidebar later.

### Director nav groups (the sidebar)

- **Overview** — Dashboard
- **Intake** — Applications · Invites · Enrollments
- **People** — Members · Guardianships · Pods & terms
- **Safety** — Moderation · Media · Requests (deletion/export)
- **Content** — Newsletter & reviews
- **Oversight** — Audit log

## Per-surface behavior & data seams

Every surface has a server seam in `lib/portal/director/<surface>-data.ts` following the student pattern: read `cl_session` → `GET /api/auth/session`, gate on a `chapter_director` membership, use its `chapterId`; then either call the live read (if it exists) or return representative fallback. A shared helper `lib/portal/director/session.ts` `getDirectorContext()` does the session read + director gate once and returns `{ origin, cookie, chapterId } | null` (null → fallback everywhere). All fallbacks set `isSample: true` and the page shows a small "Sample data" affordance.

| Surface | Read source (today) | Writes wired |
|---|---|---|
| **Dashboard** | fallback summary (derives counts once the surface GETs land) | — |
| **Applications** list + detail | fallback → `GET /api/ops/applications`, `…/{id}` *(backend GET needed)* | `PATCH /api/ops/applications/{id}` (screen / schedule-interview / accept / decline / withdraw / reopen) |
| **Invites** | fallback list → `GET /api/ops/invites` *(needed)* | `POST /api/ops/invites` (issue) ✓ live now; `POST …/{id}/resend` ✓ |
| **Enrollments** | fallback → `GET /api/ops/enrollments` *(needed)* | `POST /api/ops/enrollments` (from an accepted application) |
| **Members** roster | fallback → `GET /api/ops/memberships` *(needed)* | `POST /api/ops/memberships/{id}/activate` |
| **Guardianships** | fallback → `GET /api/ops/guardianships` *(needed)* | `POST …/{id}/verify`, `POST …/{id}/revoke` |
| **Moderation** | **live** `GET /api/lab/moderation/queue` | (mentor-owned actions; director views) |
| **Media** | fallback → `GET /api/ops/media/review-queue` *(needed)* | `POST …/{id}/confirm-depiction` / `clear` / `remove` |
| **Requests** (deletion/export) | fallback → `GET /api/ops/deletion-requests`, `…/export-requests` *(needed)* | deletion `review`/`fulfill`, export `fulfill` |
| **Pods & terms** | fallback → `GET /api/ops/pods`, `…/terms` *(needed)* | `POST /api/ops/pods`, `…/assignments`, `POST/PATCH /api/ops/terms` |
| **Content** | published narratives/projects (existing public reads) | narrative review, project publish/unpublish, `POST /api/ops/newsletter` |
| **Audit** | **live** `GET /api/ops/audit` | — |

The list of eight-ish reads marked *(needed)* is specified for the backend agent in `docs/platform/director-portal-read-endpoints.md`. Moderation and audit are live today.

## Theme

`data-portal="director"` tokens already exist (`app/portal/portal-theme.css`): accent `#C94F40` (coral), soft `#F7E2DE`, chip `#E56252`, red banner gradient, plus dark-mode overrides. Components read `var(--pt-*)` — never hardcode the accent (the same rule the student components follow).

## The invite surface (Phase 1 detail)

**Director → Invites page** (`app/portal/director/invites/page.tsx` + client):

- **Issue form:** kind selector (Guardian / Mentor / Staff), target email (optional), submit → `POST /api/ops/invites` with `{ kind, chapterId, targetEmail }`. On `201`, render the result card: the shareable link `<origin>/invite/<token>` with a copy button, the expiry, and a note that the token is shown once. `chapterId` comes from the director session; on fallback (no session) the form is visible but issuing is disabled with a "sign in as a director to issue invites" note.
- **Pending invites list:** fallback rows today (id, kind, target, issued, expires) → real once `GET /api/ops/invites` lands; each row has **Resend** → `POST /api/ops/invites/{id}/resend` → shows the fresh link/expiry.

**Public accept page** (`app/invite/[token]/page.tsx`):

- Server: `GET /api/invites/<token>` → `{ usable, kind, chapter }`. Not usable → a plain "this invite link is no longer valid" card. Usable → header (kind + chapter) + the accept form.
- **Email path** (kind guardian/mentor/staff): fields email, password, legal name, display name, date of birth → `POST /api/invites/<token>/accept`. On `201` → success card: "Your account is created and is pending activation by the Chapter Director. You'll be able to sign in once it's active." A guardian result additionally notes they'll invite their student from the guardian portal after activation.
- **Username path** (kind student): fields username, password, legal name, display name (DOB omitted — copied from the enrollment record) → `POST /api/invites/<token>/accept-student`. Same pending-activation success copy. This page is reached only via a guardian-issued student token.
- Client-side: required-field validation, `400`/`401`/`404` mapped to friendly copy (invalid/expired/mismatch), no PII beyond what each endpoint requires.

## Testing

- Types compile (`tsc`).
- **Unit test** the kind→portal mapping helper (`inviteKindToPortal`: guardian→parent, mentor→mentor, staff→director/staff surface, student→student) — pure function, in `test/`.
- **Unit test** `getDirectorContext` gating logic where practical (director membership present → context; absent → null) via a small pure `pickDirectorChapter(memberships)` helper.
- `npm run lint` and `npm run build --webpack` green; `/portal/director` + subpages and `/invite/[token]` appear in the build; marketing Nav/Footer absent on `/portal` and `/invite`, present elsewhere.

## Phasing (build order — the plan details Phase 1 for execution)

- **Phase 1 — fully live now, no backend deps:** `PortalShell` sidebar extension; director layout + sidebar; Dashboard (fallback summary); **Invites** (issue live + resend + fallback list); **public accept pages** (`/invite/[token]`, both paths, live). Delivers the invite→account priority end-to-end. Plus the moderation & audit surfaces, which read live today.
- **Phase 2:** Applications (list + detail + transitions), Members roster (+ activate) — fallback now, auto-live when their GETs land.
- **Phase 3:** Guardianships, Media, Requests (deletion/export).
- **Phase 4:** Enrollments, Pods & terms, Content (newsletter + narrative/project review).

Phases 2–4 each reuse Phase 1's seam + shell + theme exactly; each gets its own bite-sized plan when its backend GET is confirmed, so the plan doc doesn't ship placeholder code against endpoints that don't exist yet.

## Risks

- **Shared branch `feat/platform-m1`** — everything additive; stage exact files (never `git add -A`); no `packages/*` edits; don't collide with the backend agent.
- **`PortalShell` change touches a shipped component** — keep the sidebar strictly additive (omitted prop → identical current behavior); the student portal must be visually unchanged.
- **Fallback honesty** — representative data is obviously synthetic and every fallback surface shows a "Sample data" affordance, so a director never mistakes it for their real chapter's records.
- **Token handling** — the raw invite token is shown once and never logged; the accept pages send only the fields each endpoint requires.
