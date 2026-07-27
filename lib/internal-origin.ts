// The ONE place a SELF-CALL's origin is decided.
//
// Several server components and route handlers call this same app over HTTP to
// reuse an API route's authorization instead of duplicating it, and they forward
// the caller's `cl_session` cookie so the downstream route sees the real actor.
// That makes the target origin security-relevant: whatever host we pick is a host
// we hand a live session cookie to.
//
// So the Host header is NOT trusted. A request's `Host` is set by the client, and
// a deployment that has not set APP_URL would otherwise forward a director's
// session cookie to any host an attacker put in that header. The only exception is
// a LOOPBACK host, because "send it to our own machine" is where it was going
// anyway, and that is what makes a keyless local dev checkout work unchanged.
//
// Precedence:
//   1. APP_URL — the explicit deployment override (set this in production).
//   2. NEXT_PUBLIC_SITE_URL — honoured for backwards compatibility.
//   3. The request's Host, but ONLY when it is loopback (localhost / 127.0.0.1 / ::1).
//   4. http://127.0.0.1:${PORT ?? 3000} — the last-resort loopback.
//
// This is deliberately NOT lib/app-url.ts. That one decides the base URL for
// links in OUTBOUND MAIL, which must be the address a person can actually open in
// a browser; this one decides where a server-to-self request goes, which must be
// somewhere we control. They agree in production and differ in dev, and conflating
// them is how a loopback URL ends up in an email.

import { cookies, headers } from "next/headers";

/** Hosts that are unambiguously this machine. */
function isLoopbackHost(host: string): boolean {
  const name = (host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.split(":")[0] ?? "").toLowerCase();
  return name === "localhost" || name === "127.0.0.1" || name === "::1" || name.endsWith(".localhost");
}

function stripTrailingSlash(u: string): string {
  return u.endsWith("/") ? u.slice(0, -1) : u;
}

/**
 * The origin to use for a server-to-self HTTP call. `requestHost` is the incoming
 * request's Host header when the caller has one; it is honoured only if loopback.
 */
export function internalOrigin(requestHost?: string | null): string {
  const explicit = process.env.APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit !== undefined && explicit !== "") return stripTrailingSlash(explicit);
  if (requestHost != null && requestHost !== "" && isLoopbackHost(requestHost)) {
    const proto = requestHost.startsWith("localhost") || isLoopbackHost(requestHost) ? "http" : "https";
    return `${proto}://${requestHost}`;
  }
  return `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
}

/** The origin plus the caller's session cookie, for a server component's self-call. */
export interface InternalCallContext {
  origin: string;
  /** A `cl_session=...` Cookie header value. */
  cookie: string;
}

/**
 * The caller's request context for a self-call, or null when there is no session
 * cookie to forward (in which case there is nothing an authenticated read could
 * return, so the caller should not make the request at all).
 *
 * This replaces the two near-identical `originAndCookie` helpers that used to
 * live in lib/portal/director/session.ts and lib/portal/settings/my-info-data.ts;
 * both trusted the Host header, and neither can now drift from the other.
 */
export async function originAndCookie(): Promise<InternalCallContext | null> {
  const session = (await cookies()).get("cl_session");
  if (!session) return null;
  const host = (await headers()).get("host");
  return { origin: internalOrigin(host), cookie: `cl_session=${session.value}` };
}
