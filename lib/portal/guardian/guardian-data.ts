import { cookies, headers } from "next/headers";
import type { GuardianView } from "./types";
import { REPRESENTATIVE_GUARDIAN_VIEW } from "./sample";

interface SessionResp {
  accountId?: string;
  guardianOf?: string[];
}

/** Read cl_session → GET /api/auth/session, require a guardian (guardianOf > 0).
 *  No backend guardian read exists yet, so return the representative view either
 *  way (isSample stays true). Flips to live when the guardian GETs land. */
export async function getGuardianView(): Promise<GuardianView> {
  try {
    const session = (await cookies()).get("cl_session");
    if (!session) return REPRESENTATIVE_GUARDIAN_VIEW;
    const h = await headers();
    const host = h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "http";
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? (host ? `${proto}://${host}` : "");
    if (!origin) return REPRESENTATIVE_GUARDIAN_VIEW;
    const cookie = `cl_session=${session.value}`;
    const sres = await fetch(`${origin}/api/auth/session`, { headers: { cookie }, cache: "no-store" });
    if (!sres.ok) return REPRESENTATIVE_GUARDIAN_VIEW;
    const s = (await sres.json()) as SessionResp;
    const isGuardian = (s.guardianOf ?? []).length > 0;
    if (!s.accountId || !isGuardian) return REPRESENTATIVE_GUARDIAN_VIEW;
    // Wire real children/grants/public items here once the guardian GETs exist.
    return REPRESENTATIVE_GUARDIAN_VIEW;
  } catch {
    return REPRESENTATIVE_GUARDIAN_VIEW;
  }
}
