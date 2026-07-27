import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  PORTAL_PATH_HEADER,
  SESSION_COOKIE_NAME,
  isDirectorPath,
  loginRedirect,
} from "@/lib/portal/director/gate";

/**
 * This is the `proxy` file convention — the renamed successor to `middleware` in
 * this Next version (16.2.10); see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md.
 * Only ONE proxy file is supported per project, so both jobs below live here and
 * `config.matcher` keeps each scoped to its own routes. Every other route is
 * untouched.
 *
 * Job 1 — /portal/director/*: refuse the request BEFORE the route renders.
 *   Per the same doc, "Proxy executes before routes are rendered", and its
 *   execution-order list runs Proxy (step 3) ahead of filesystem routes (step 5),
 *   which is why this and not a layout is what actually prevents a director
 *   page's data fetching from starting.
 *
 *   The check here is deliberately CHEAP — cookie presence, no database. The
 *   installed authentication guide is explicit that Proxy "runs on every route,
 *   including prefetched routes", so "it's important to only read the session
 *   from the cookie (optimistic checks), and avoid database checks to prevent
 *   performance issues", and that Proxy "should not be your only line of
 *   defense". The authoritative check (a live session resolving to an ACTIVE
 *   chapter_director / platform_admin membership) is requireDirector(), called at
 *   the top of every director page; this layer just means an anonymous visitor
 *   never reaches one.
 *
 * Job 2 — /invite/*, /reset-password/*: set `Referrer-Policy: no-referrer` so a
 *   single-use token in the URL can never leak through the Referer header to
 *   whatever a page links out to.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isDirectorPath(pathname)) {
    if (!request.cookies.has(SESSION_COOKIE_NAME)) {
      return NextResponse.redirect(new URL(loginRedirect(pathname), request.nextUrl));
    }
    // Hand the matched path down to requireDirector(). A server component cannot
    // read its own URL, and the docs' recommended way to pass information from
    // Proxy to the application is a request header.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(PORTAL_PATH_HEADER, pathname);
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const res = NextResponse.next();
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}

export const config = {
  // Every value here is a STRING LITERAL on purpose: the proxy docs note that
  // "matcher values need to be constants so they can be statically analyzed at
  // build-time. Dynamic values such as variables will be ignored" — an imported
  // constant would be silently dropped, leaving the route ungated. Both forms of
  // the director prefix are listed so the portal root is covered as well as its
  // children.
  matcher: [
    "/invite/:path*",
    "/reset-password/:path*",
    "/portal/director",
    "/portal/director/:path*",
  ],
};
