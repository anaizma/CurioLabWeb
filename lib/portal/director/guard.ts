// The authoritative /portal/director gate. See gate.ts for why there are two
// layers and what the installed Next 16 docs say about each.
//
// Call `requireDirector()` as the FIRST statement of every page under
// app/portal/director. It either returns (and the page renders) or it throws the
// redirect, which means no data helper below it ever runs.

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { originAndCookie } from "@/lib/internal-origin";
import {
  DIRECTOR_PORTAL_PREFIX,
  PORTAL_PATH_HEADER,
  hasDirectorAccess,
  loginRedirect,
  type GateMembership,
} from "./gate";

interface SessionResponse {
  accountId?: string;
  memberships?: GateMembership[];
}

/** Who the gate let through. */
export interface DirectorPrincipal {
  accountId: string;
}

/** The path the proxy matched, so the `?next=` link points back where they asked. */
async function requestedPath(): Promise<string> {
  const stamped = (await headers()).get(PORTAL_PATH_HEADER);
  return stamped !== null && stamped !== "" ? stamped : DIRECTOR_PORTAL_PREFIX;
}

/**
 * Require an active chapter_director or platform_admin session, or redirect to
 * /login?next=<the path they asked for>.
 *
 * FAILS CLOSED. Anything short of a positive answer — no cookie, a non-200 from
 * the session endpoint, an unparseable body, a thrown fetch — redirects. The
 * fetch is inside the try and the redirect is outside it, because redirect()
 * signals by throwing and a catch around it would swallow the redirect itself.
 */
export async function requireDirector(): Promise<DirectorPrincipal> {
  const path = await requestedPath();

  let summary: SessionResponse | null = null;
  try {
    const ctx = await originAndCookie();
    if (ctx !== null) {
      const res = await fetch(`${ctx.origin}/api/auth/session`, {
        headers: { cookie: ctx.cookie },
        cache: "no-store",
      });
      if (res.ok) summary = (await res.json()) as SessionResponse;
    }
  } catch {
    summary = null;
  }

  if (summary === null || !summary.accountId || !hasDirectorAccess(summary.memberships)) {
    redirect(loginRedirect(path));
  }
  return { accountId: summary.accountId };
}
