import { NextResponse } from "next/server";

/**
 * Set `Referrer-Policy: no-referrer` on the public invite-acceptance pages so an
 * invite token in the URL can never leak through the Referer header. Scoped to
 * `/invite/*` via config.matcher — every other route is untouched.
 *
 * (This is the `proxy` file convention — the renamed successor to `middleware`
 * in this Next version; see node_modules/next/dist/docs/.../proxy.md.)
 */
export function proxy() {
  const res = NextResponse.next();
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}

export const config = {
  matcher: "/invite/:path*",
};
