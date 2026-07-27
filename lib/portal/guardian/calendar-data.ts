import { cookies, headers } from "next/headers";

export type GuardianCalKind = "session" | "orientation" | "meeting" | "other";

export interface GuardianCalEvent {
  id: string;
  title: string;
  kind: GuardianCalKind;
  startsAt: string;
  endsAt: string;
  location: string | null;
  notes: string | null;
}

export interface GuardianCalendarView {
  events: GuardianCalEvent[];
  live: boolean;
  isSample: boolean;
}

function normKind(k: string | undefined): GuardianCalKind {
  return k === "orientation" || k === "meeting" || k === "other" ? k : "session";
}

function sampleEvents(): GuardianCalEvent[] {
  // No invented sessions. This used to synthesise eight weekly build sessions
  // and a "Family showcase night", complete with rooms and times, and serve them
  // whenever the calendar could not be read. A parent could have shown up for a
  // session that does not exist. It now returns nothing and the banner explains.
  return [];
}

/** Parent-audience chapter events: live via GET /api/guardian/calendar when a
 *  guardian session exists, representative fallback otherwise. */
export async function getGuardianCalendarView(): Promise<GuardianCalendarView> {
  const fallback: GuardianCalendarView = { events: sampleEvents(), live: false, isSample: true };
  try {
    const session = (await cookies()).get("cl_session");
    if (!session) return fallback;
    const h = await headers();
    const host = h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "http";
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? (host ? `${proto}://${host}` : "");
    if (!origin) return fallback;
    const res = await fetch(`${origin}/api/guardian/calendar`, { headers: { cookie: `cl_session=${session.value}` }, cache: "no-store" });
    if (!res.ok) return fallback;
    const data = (await res.json()) as { items?: { id?: string; title?: string; kind?: string; startsAt?: string; endsAt?: string; location?: string | null; notes?: string | null }[] };
    const events: GuardianCalEvent[] = (data.items ?? []).map((e, i) => ({
      id: e.id ?? `evt${i}`,
      title: e.title ?? "Untitled",
      kind: normKind(e.kind),
      startsAt: e.startsAt ?? "",
      endsAt: e.endsAt ?? "",
      location: e.location ?? null,
      notes: e.notes ?? null,
    }));
    return { events, live: true, isSample: false };
  } catch {
    return fallback;
  }
}
