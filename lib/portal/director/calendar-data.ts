import { getDirectorContext } from "./session";

export type CalendarKind = "session" | "orientation" | "meeting" | "other";
export type CalendarAudience = "parent" | "mentor" | "director";

export interface CalendarEvent {
  id: string;
  title: string;
  kind: CalendarKind;
  startsAt: string;
  endsAt: string;
  audiences: CalendarAudience[];
  location: string | null;
  notes: string | null;
}

export interface CalendarView {
  chapterId: string | null;
  events: CalendarEvent[];
  isSample: boolean;
}

const SAMPLE: CalendarEvent[] = [];

function normKind(k: string | undefined): CalendarKind {
  return k === "orientation" || k === "meeting" || k === "other" ? k : "session";
}

export async function getCalendarView(): Promise<CalendarView> {
  const ctx = await getDirectorContext();
  if (!ctx) return { chapterId: null, events: SAMPLE, isSample: true };
  try {
    const res = await fetch(`${ctx.origin}/api/ops/calendar?chapterId=${encodeURIComponent(ctx.chapterId)}`, { headers: { cookie: ctx.cookie }, cache: "no-store" });
    if (!res.ok) return { chapterId: ctx.chapterId, events: SAMPLE, isSample: true };
    const data = (await res.json()) as { items?: { id?: string; title?: string; kind?: string; startsAt?: string; endsAt?: string; audiences?: string[]; location?: string | null; notes?: string | null }[] };
    const events: CalendarEvent[] = (data.items ?? []).map((e, i) => ({
      id: e.id ?? `evt${i}`,
      title: e.title ?? "Untitled",
      kind: normKind(e.kind),
      startsAt: e.startsAt ?? "",
      endsAt: e.endsAt ?? "",
      audiences: (Array.isArray(e.audiences) ? e.audiences : []).filter((a): a is CalendarAudience => a === "parent" || a === "mentor" || a === "director"),
      location: e.location ?? null,
      notes: e.notes ?? null,
    }));
    return { chapterId: ctx.chapterId, events, isSample: false };
  } catch {
    return { chapterId: ctx.chapterId, events: SAMPLE, isSample: true };
  }
}
