// -------------------------------------------------------------------------
// The /portal/director access rule, as pure functions.
//
// Split out from guard.ts so `proxy.ts` can import it: the proxy runs before the
// app does and must not pull `next/headers`, `@curiolab/http`, or the Postgres
// driver behind them into its bundle.
//
// WHY TWO LAYERS PROTECT THIS ROUTE, per the INSTALLED Next docs (16.2.10):
//
//   1. proxy.ts — Next 16 renamed `middleware` to `proxy`
//      (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/
//      proxy.md: "The `middleware` file convention is deprecated and has been
//      renamed to `proxy`"). That doc also states "Proxy executes before routes
//      are rendered", and its execution-order list puts Proxy at step 3 with
//      filesystem routes at step 5. It is therefore the ONLY construct here that
//      stops a page's own data fetching from starting at all. What it does is
//      deliberately cheap — cookie PRESENCE, no database — because the same
//      docs' authentication guide warns Proxy "runs on every route, including
//      prefetched routes", so "it's important to only read the session from the
//      cookie (optimistic checks), and avoid database checks".
//
//   2. requireDirector() — the AUTHORITATIVE check, called as the first
//      statement of every page under app/portal/director. It resolves the cookie
//      to a real session and requires an ACTIVE chapter_director or
//      platform_admin membership. The same guide: "While Proxy can be useful for
//      initial checks, it should not be your only line of defense in protecting
//      your data. The majority of security checks should be performed as close as
//      possible to your data source."
//
// A LAYOUT gate is deliberately NOT used. The authentication guide is explicit:
// "Due to Partial Rendering, be cautious when doing checks in Layouts as these
// don't re-render on navigation, meaning the user session won't be checked on
// every route change", and "A common pattern in SPAs is to `return null` in a
// layout or a top-level component if a user is not authorized. This pattern is
// not recommended since Next.js applications have multiple entry points, which
// will not prevent nested route segments and Server Actions from being accessed."
// On top of that, app/portal/director/layout.tsx is a "use client" component, so
// it could not call redirect() even if the pattern were sound.
//
// HONEST LIMIT: all of this stops the UI from RENDERING. It is not what protects
// the data. Every /api/ops and /api/admin route runs its own `runAuthed` +
// `authorize` check independently, and that is what actually refuses a stranger.
// -------------------------------------------------------------------------

/** The route prefix this gate covers. Other portals are deliberately untouched. */
export const DIRECTOR_PORTAL_PREFIX = "/portal/director";

/**
 * The session cookie name. Mirrors SESSION_COOKIE in @curiolab/http, which the
 * proxy bundle must not import (it would drag the Postgres driver in). If that
 * constant ever changes, this changes with it.
 */
export const SESSION_COOKIE_NAME = "cl_session";

/**
 * Request header the proxy stamps with the path it matched, so the page-level
 * guard can build the same `?next=` link without a server component having to
 * guess its own URL.
 */
export const PORTAL_PATH_HEADER = "x-curiolab-portal-path";

/** Membership shape as GET /api/auth/session returns it. */
export interface GateMembership {
  role?: string;
  status?: string;
}

/**
 * The roles that may open the director portal. Deliberately NARROWER than the
 * privileged set that mandates TOTP: a mentor or a comms associate is privileged
 * enough to need a second factor, but the director portal shows every applicant
 * in the chapter, so it is limited to the two roles that are supposed to read
 * that. There is no mentor portal yet, so those accounts land on the public site.
 */
const DIRECTOR_PORTAL_ROLES: ReadonlySet<string> = new Set(["chapter_director", "platform_admin"]);

/** Whether `pathname` is inside the director portal. */
export function isDirectorPath(pathname: string): boolean {
  return pathname === DIRECTOR_PORTAL_PREFIX || pathname.startsWith(`${DIRECTOR_PORTAL_PREFIX}/`);
}

/**
 * Whether these memberships open the director portal. The `active` check is
 * load-bearing: a suspended or lapsed director keeps the membership ROW, and
 * without this they would keep the portal too.
 */
export function hasDirectorAccess(memberships: readonly GateMembership[] | undefined): boolean {
  return (memberships ?? []).some(
    (m) => m.status === "active" && m.role !== undefined && DIRECTOR_PORTAL_ROLES.has(m.role),
  );
}

/**
 * Where a refused request goes. `next` carries the path they asked for so they
 * land there after signing in instead of on a generic dashboard. Only a relative
 * in-app path is ever put in it (see safeNextPath).
 */
export function loginRedirect(pathname: string): string {
  return `/login?next=${encodeURIComponent(safeNextPath(pathname))}`;
}

/**
 * Sanitise a `?next=` value before it is used as a redirect target. Anything that
 * is not a single-slash-prefixed in-app path (an absolute URL, a protocol-relative
 * `//evil.example`, a backslash) falls back to the director home, so the login
 * page can never be turned into an open redirect.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (next == null || next === "") return DIRECTOR_PORTAL_PREFIX;
  if (!next.startsWith("/")) return DIRECTOR_PORTAL_PREFIX;
  if (next.startsWith("//") || next.startsWith("/\\")) return DIRECTOR_PORTAL_PREFIX;
  if (next.includes("\\")) return DIRECTOR_PORTAL_PREFIX;
  return next;
}
