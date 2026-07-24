# Guardian portal (demo) — design

Date: 2026-07-24
Status: approved (collaborative design), demo build
Related: `docs/superpowers/specs/2026-07-23-director-portal-design.md`; the portals architecture (student/director already shipped); the consent **grant-ledger** model (backend amendment §5 — six independent append-only grants).

## Goal

A **demo** of the guardian portal (orange theme) that shows the "guardian account as the front door" consent architecture we agreed on:
- a per-child **consent checklist of six independent grants** with **mixed states** — most are a click, `public_publication` for an under-13 needs a **signed-form / strong-verification** step;
- the **notify-and-object window** for standing publication (a nominated post publishes unless the guardian objects within N days);
- a **read-only child public-visibility panel** — what the child has made public, never drafts or private messages.

Synthetic data only (everything `isSample`). This demonstrates the design; it does not capture real consent — real grant capture, the strong-verification upload, and the object timer are backend + legal-gated.

## Non-goals (this demo)

- No real grant capture/revocation writes, no file-upload backend, no real object timer, no email. Toggles/object/upload are **visual, local-state only** and read as a demo.
- No backend GETs (guardian children / grants / public items don't exist yet) — the seam returns representative fallback, exactly like the director fallback surfaces.
- No `packages/*` edits. Purely `app/`, `components/`, `lib/`.
- Not the login/switcher (separate slice). This assumes a guardian context.

## Architecture & routing

- Routes under `/portal/parent/*` (the routing table maps guardian→parent portal; the theme key is `parent` = orange). `roleLabel` is **"Guardian"**.
- `app/portal/parent/layout.tsx` — client layout: `<PortalShell role="parent" roleLabel="Guardian" nav={GUARDIAN_NAV} activeHref={…}>` (top-nav like the student portal; a guardian has few surfaces). Active tab computed from `usePathname()`.
- Pages: `page.tsx` (Home), `consent/page.tsx`, `activity/page.tsx`.
- Data seam `lib/portal/guardian/guardian-data.ts` `getGuardianView()`: read `cl_session` → `GET /api/auth/session`, gate on `guardianOf.length > 0`; no backend read exists yet, so return the representative `GuardianView` (`isSample: true`) either way. Mirrors `getDirectorContext` / the director seams. Reuses `components/portal/SampleBanner.tsx`.

## Surfaces

- **Home (`/portal/parent`)** — greeting + child card (name · age band · chapter), a **"Needs your attention"** block surfacing (a) the pending newsletter **nomination** in its object-window and (b) an **expiring** grant, plus a one-line consent summary ("5 of 6 grants active · 1 needs a signed form"). Links to Consent and Activity.
- **Consent (`/portal/parent/consent`)** — the centerpiece. Per-child **six-grant checklist**; each grant renders: label, plain-language description, a **status chip** (Granted / Needs signed form / Pending / Expiring soon / Revoked), a **method badge** (Click vs Signed form), renewal/expiry line, and a **revoke toggle** where `revocable`. `public_publication` (under-13) shows an **"Upload signed form"** affordance instead of a checkbox (the strong-verification path). A short note frames it: "Each item is separate — you can withdraw one without leaving the program." Client component; toggles/upload are local visual state.
- **Child activity (`/portal/parent/activity`)** — read-only **public-visibility panel**: only the child's **public** posts/projects (community / newsletter / public profile), each tagged with its surface. A framing line: "This is everything of {child}'s that's visible outside CurioLab. Drafts and private posts are never shown here." Demonstrates the transparency argument.
- **Notify-and-object element** (on Home + Consent): a nomination card — "{child}'s post '{title}' is nominated for the newsletter — publishes in {N} days unless you object" + an **Object** button (local toggle → "Objected — withheld"). Encodes that standing consent arms a window, not blanket pre-approval.

## Data model (`lib/portal/guardian/types.ts`)

- `GuardianChild { id, displayName, ageBand, chapterName }`
- `GrantStatus = "granted" | "needs_form" | "pending" | "expiring" | "revoked"`
- `GrantMethod = "click" | "signed_form"`
- `ConsentGrant { grantType, label, description, status, method, renewalLabel, expiresLabel, revocable }` — the six: program_participation, platform_account, public_publication, photo_video_likeness, emergency_medical_pickup, verification_link_sharing.
- `PublicItem { id, title, kind: "post" | "project", surfaceLabel, dateLabel }`
- `Nomination { id, itemTitle, surfaceLabel, publishesInLabel }`
- `GuardianView { child, grants, publicItems, nominations, isSample }`

Representative sample: child "Ari" (age band "Under 13", CWRU). Grants mixed — participation/account/medical/verification granted-by-click, `public_publication` `needs_form`, `photo_video_likeness` granted-but-expiring. One nomination ("Recycling robot" → newsletter, 5 days). One or two public items + the "drafts hidden" note.

## Testing

- Types compile; `npm run build --webpack` green (retry past the known `@node-rs/argon2` flake); `/portal/parent`, `/portal/parent/consent`, `/portal/parent/activity` in the route list.
- Student/director portals visually unchanged (parent theme is separate `data-portal`).

## Risks

- **Shared branch** — additive; stage exact files; no `packages/*`.
- **Must read as a demo** — SampleBanner on every surface, obviously-synthetic names, visual-only controls, so no real consent semantics are implied.
