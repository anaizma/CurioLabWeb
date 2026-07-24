import { cookies, headers } from "next/headers";

export interface AttendanceSession {
  eventId: string;
  startsAt: string;
}
export interface AttendanceExisting {
  sessionEventId: string;
  type: "absent" | "late";
  reason: string | null;
  arriveAt: string | null;
  makeupStatus: string | null;
}
export interface AttendanceCounts {
  totalAbsences: number;
  outstanding: number;
  madeUp: number;
  late: number;
}
export interface SampleAttendanceRecord {
  dateKey: string;
  type: "absent" | "late";
  reason?: string;
  arrive?: string;
  slots?: string[];
  madeUp?: boolean;
}
export interface AttendanceView {
  childId: string | null;
  sessions: AttendanceSession[];
  existing: AttendanceExisting[];
  counts: AttendanceCounts;
  sampleRecords: SampleAttendanceRecord[];
  live: boolean;
  isSample: boolean;
}

const ZERO: AttendanceCounts = { totalAbsences: 0, outstanding: 0, madeUp: 0, late: 0 };

function keyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Two representative past exceptions, anchored to recent Saturdays so they are
 *  reachable in the month view. */
function buildSampleRecords(): SampleAttendanceRecord[] {
  const sat = new Date();
  sat.setDate(sat.getDate() - ((sat.getDay() + 1) % 7));
  const lastWeek = new Date(sat);
  lastWeek.setDate(lastWeek.getDate() - 7);
  const threeBack = new Date(sat);
  threeBack.setDate(threeBack.getDate() - 21);
  return [
    { dateKey: keyOf(threeBack), type: "absent", reason: "Family travel", slots: ["Wed · 7:00 PM"], madeUp: true },
    { dateKey: keyOf(lastWeek), type: "late", arrive: "10:25" },
  ];
}

export async function getAttendanceView(): Promise<AttendanceView> {
  const empty: AttendanceView = { childId: null, sessions: [], existing: [], counts: ZERO, sampleRecords: buildSampleRecords(), live: false, isSample: true };
  try {
    const session = (await cookies()).get("cl_session");
    if (!session) return empty;
    const h = await headers();
    const host = h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "http";
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? (host ? `${proto}://${host}` : "");
    if (!origin) return empty;
    const cookie = `cl_session=${session.value}`;

    const sres = await fetch(`${origin}/api/auth/session`, { headers: { cookie }, cache: "no-store" });
    if (!sres.ok) return empty;
    const s = (await sres.json()) as { guardianOf?: string[] };
    const childId = (s.guardianOf ?? [])[0] ?? null;
    if (!childId) return empty;

    const sessions: AttendanceSession[] = [];
    const cres = await fetch(`${origin}/api/guardian/calendar`, { headers: { cookie }, cache: "no-store" });
    if (cres.ok) {
      const cdata = (await cres.json()) as { items?: { id?: string; kind?: string; startsAt?: string }[] };
      (cdata.items ?? []).forEach((e) => {
        if (e.kind === "session" && e.id && e.startsAt) sessions.push({ eventId: e.id, startsAt: e.startsAt });
      });
    }

    let existing: AttendanceExisting[] = [];
    let counts = ZERO;
    const ares = await fetch(`${origin}/api/guardian/children/${childId}/attendance`, { headers: { cookie }, cache: "no-store" });
    if (ares.ok) {
      const adata = (await ares.json()) as { items?: { sessionEventId?: string; type?: string; reason?: string | null; arriveAt?: string | null; makeupStatus?: string | null }[]; counts?: AttendanceCounts };
      existing = (adata.items ?? [])
        .filter((x) => x.sessionEventId && (x.type === "absent" || x.type === "late"))
        .map((x) => ({
          sessionEventId: x.sessionEventId as string,
          type: x.type as "absent" | "late",
          reason: x.reason ?? null,
          arriveAt: x.arriveAt ?? null,
          makeupStatus: x.makeupStatus ?? null,
        }));
      counts = adata.counts ?? ZERO;
    }
    return { childId, sessions, existing, counts, sampleRecords: buildSampleRecords(), live: true, isSample: false };
  } catch {
    return empty;
  }
}
