import { cookies, headers } from "next/headers";
import { pickDirectorChapter, type SessionMembership } from "./pick-chapter";

export interface DirectorContext {
  origin: string;
  cookie: string;
  chapterId: string;
  accountId: string;
}

interface SessionResp {
  accountId?: string;
  memberships?: SessionMembership[];
}

/** Read cl_session → GET /api/auth/session, require a chapter_director membership.
 *  Returns the director's request context, or null (→ representative fallback). */
export async function getDirectorContext(): Promise<DirectorContext | null> {
  try {
    const session = (await cookies()).get("cl_session");
    if (!session) return null;
    const h = await headers();
    const host = h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "http";
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? (host ? `${proto}://${host}` : "");
    if (!origin) return null;
    const cookie = `cl_session=${session.value}`;

    const sres = await fetch(`${origin}/api/auth/session`, { headers: { cookie }, cache: "no-store" });
    if (!sres.ok) return null;
    const s = (await sres.json()) as SessionResp;
    const chapterId = pickDirectorChapter(s.memberships ?? []);
    if (!s.accountId || !chapterId) return null;
    return { origin, cookie, chapterId, accountId: s.accountId };
  } catch {
    return null;
  }
}
