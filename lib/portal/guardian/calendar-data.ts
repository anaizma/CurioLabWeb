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
  const out: GuardianCalEvent[] = [];
  const sat = new Date();
  sat.setDate(sat.getDate() - ((sat.getDay() + 1) % 7));
  for (let i = -2; i <= 5; i++) {
    const d = new Date(sat);
    d.setDate(d.getDate() + i * 7);
    const s = new Date(d);
    s.setHours(10, 0, 0, 0);
    const e = new Date(d);
    e.setHours(12, 0, 0, 0);
    out.push({ id: `sample_sess_${i + 2}`, title: "Weekly build session", kind: "session", startsAt: s.toISOString(), endsAt: e.toISOString(), location: "Sears think[box], Room 3", notes: null });
  }
  const showcase = new Date(sat);
  showcase.setDate(showcase.getDate() + 18);
  showcase.setHours(17, 30, 0, 0);
  const showcaseEnd = new Date(showcase);
  showcaseEnd.setHours(19, 0, 0, 0);
  out.push({ id: "sample_showcase", title: "Family showcase night", kind: "meeting", startsAt: showcase.toISOString(), endsAt: showcaseEnd.toISOString(), location: "CWRU campus — Thwing Center", notes: "Students present their term projects. Families welcome." });
  return out;
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
