"use client";

import { useState } from "react";
import type { GuardianCalEvent } from "@/lib/portal/guardian/calendar-data";

const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
type Rsvp = "yes" | "no";
type Section = "upcoming" | "past" | "mine";

function keyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function timeOf(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function fmtFull(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: "rgba(3,35,68,.4)" }} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl max-h-[86vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export default function GuardianCalendarClient({ events, absentKeys }: { events: GuardianCalEvent[]; absentKeys: string[] }) {
  const today = new Date();
  const [cursor, setCursor] = useState(new Date());
  const [view, setView] = useState<"month" | "week">("month");
  const [openEv, setOpenEv] = useState<GuardianCalEvent | null>(null);
  const [rsvps, setRsvps] = useState<Record<string, Rsvp>>({});
  const [open, setOpen] = useState<Record<Section, boolean>>({ upcoming: true, past: false, mine: false });
  const [expanded, setExpanded] = useState<Record<Section, boolean>>({ upcoming: false, past: false, mine: false });
  const anyExpanded = expanded.upcoming || expanded.past || expanded.mine;

  const absentSet = new Set(absentKeys);
  const nowMs = Date.now();
  const valid = events.filter((e) => !isNaN(new Date(e.startsAt).getTime()));
  const upcoming = valid.filter((e) => new Date(e.startsAt).getTime() >= nowMs).sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  const past = valid.filter((e) => new Date(e.startsAt).getTime() < nowMs).sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());
  const mine = past.filter((e) => !absentSet.has(keyOf(new Date(e.startsAt))));

  const byDay = new Map<string, GuardianCalEvent[]>();
  valid.forEach((e) => {
    const k = keyOf(new Date(e.startsAt));
    const arr = byDay.get(k) ?? [];
    arr.push(e);
    byDay.set(k, arr);
  });
  byDay.forEach((arr) => arr.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()));

  const todayKey = keyOf(today);
  function go(delta: number) {
    if (view === "month" || anyExpanded) setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1));
    else { const d = new Date(cursor); d.setDate(d.getDate() + delta * 7); setCursor(d); }
  }
  function toggleOpen(s: Section) {
    setOpen((p) => {
      const next = !p[s];
      if (!next) setExpanded((e) => ({ ...e, [s]: false }));
      return { ...p, [s]: next };
    });
  }

  const weekStart = new Date(cursor);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekDays = Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; });
  const weekEnd = weekDays[6];
  const label = view === "month" || anyExpanded
    ? `${MON[cursor.getMonth()]} ${cursor.getFullYear()}`
    : `${MON[weekStart.getMonth()].slice(0, 3)} ${weekStart.getDate()} – ${weekStart.getMonth() !== weekEnd.getMonth() ? MON[weekEnd.getMonth()].slice(0, 3) + " " : ""}${weekEnd.getDate()}`;

  const mFirst = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const mPad = mFirst.getDay();
  const mDays = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const monthCells: (Date | null)[] = [];
  for (let i = 0; i < mPad; i++) monthCells.push(null);
  for (let d = 1; d <= mDays; d++) monthCells.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));
  while (monthCells.length % 7 !== 0) monthCells.push(null);

  function chip(ev: GuardianCalEvent) {
    const r = rsvps[ev.id];
    return (
      <button key={ev.id} type="button" onClick={() => setOpenEv(ev)} className="block w-full min-w-0 text-left text-[10.5px] rounded px-1.5 py-0.5 truncate" style={{ background: "var(--pt-accent-soft)", color: "var(--pt-accent-fg)" }}>
        {r === "yes" ? "✓ " : r === "no" ? "✕ " : ""}{timeOf(ev.startsAt)} {ev.title}
      </button>
    );
  }

  function eventRow(ev: GuardianCalEvent, badge?: "attended" | "absent") {
    const r = rsvps[ev.id];
    return (
      <button key={ev.id} type="button" onClick={() => setOpenEv(ev)} className="w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-cream border-t border-black/[.04] first:border-t-0">
        <div className="min-w-0">
          <div className="text-[13px] font-medium truncate">{ev.title}</div>
          <div className="font-mono text-[10.5px] text-muted mt-0.5">{fmtFull(ev.startsAt)}{ev.location ? ` · ${ev.location}` : ""}</div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {r && (
            <span className="font-mono text-[9.5px] uppercase tracking-wider rounded-full px-2 py-0.5" style={r === "yes" ? { background: "#e7f2ea", color: "#2f7a4d" } : { background: "#eef0f2", color: "#556" }}>
              {r === "yes" ? "Going" : "Not going"}
            </span>
          )}
          {badge === "attended" && <span className="font-mono text-[9.5px] uppercase tracking-wider rounded-full px-2 py-0.5" style={{ background: "#e7f2ea", color: "#2f7a4d" }}>Attended</span>}
          {badge === "absent" && <span className="font-mono text-[9.5px] uppercase tracking-wider rounded-full px-2 py-0.5" style={{ background: "#fbe3df", color: "#b23b2a" }}>Absent</span>}
        </div>
      </button>
    );
  }

  function sectionCard(id: Section, title: string, items: GuardianCalEvent[], opts: { badgeFor?: (ev: GuardianCalEvent) => "attended" | "absent" | undefined }) {
    const isOpen = open[id];
    const isExpanded = expanded[id];
    const PREVIEW = 4;
    const shown = isExpanded ? items : isOpen ? items.slice(0, PREVIEW) : [];
    return (
      <div className="bg-white border border-black/[.08] rounded-lg overflow-hidden">
        <button type="button" onClick={() => toggleOpen(id)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-cream">
          <span className="label text-[10.5px]">{title} <span className="font-mono normal-case tracking-normal">({items.length})</span></span>
          <span className={`text-muted text-[13px] transition-transform ${isOpen ? "rotate-180" : ""}`}>▾</span>
        </button>
        {isOpen && shown.length > 0 && (
          <div className="border-t border-black/[.06]">
            {shown.map((ev) => eventRow(ev, opts.badgeFor?.(ev)))}
          </div>
        )}
        {isOpen && items.length > PREVIEW && (
          <button
            type="button"
            onClick={() => setExpanded((e) => ({ ...e, [id]: !isExpanded }))}
            className="w-full flex items-center justify-center gap-1 px-4 py-2 text-[11.5px] font-semibold border-t border-black/[.06] hover:bg-cream transition-colors"
            style={{ color: "var(--pt-accent)" }}
          >
            {isExpanded ? "Show fewer" : `See all ${items.length} events`}
            <span className={`transition-transform ${isExpanded ? "rotate-180" : ""}`}>▾</span>
          </button>
        )}
        {isOpen && shown.length === 0 && <div className="px-4 py-2 text-[11.5px] text-muted border-t border-black/[.04]">Nothing here.</div>}
      </div>
    );
  }

  return (
    <div className={`grid grid-cols-1 gap-4 items-start ${anyExpanded ? "lg:grid-cols-[300px_minmax(0,1fr)]" : "lg:grid-cols-[minmax(0,1fr)_340px]"}`}>
      {/* Calendar column */}
      <div className="min-w-0 lg:sticky lg:top-4 flex flex-col gap-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className={anyExpanded ? "text-[13px] font-bold" : "text-[15px] font-bold"}>{label}</div>
          <div className="flex items-center gap-1.5">
            {!anyExpanded && (
              <div className="flex rounded-md border border-black/[.12] overflow-hidden text-[11px] font-semibold">
                <button type="button" onClick={() => setView("month")} className="px-3 h-7" style={view === "month" ? { background: "var(--pt-accent)", color: "var(--pt-on-accent)" } : undefined}>Month</button>
                <button type="button" onClick={() => setView("week")} className="px-3 h-7 border-l border-black/[.12]" style={view === "week" ? { background: "var(--pt-accent)", color: "var(--pt-on-accent)" } : undefined}>Week</button>
              </div>
            )}
            <button type="button" onClick={() => go(-1)} className="rounded-md border border-black/[.12] w-7 h-7 text-sm">‹</button>
            <button type="button" onClick={() => setCursor(new Date())} className="rounded-md border border-black/[.12] px-2.5 h-7 text-[11px] font-semibold">Today</button>
            <button type="button" onClick={() => go(1)} className="rounded-md border border-black/[.12] w-7 h-7 text-sm">›</button>
          </div>
        </div>

        {anyExpanded ? (
          <div className="rounded-lg border border-black/[.08] bg-white p-2">
            <div className="grid grid-cols-7">
              {DOW.map((w) => <div key={w} className="text-center text-[8.5px] font-mono uppercase tracking-wide text-muted py-1">{w.charAt(0)}</div>)}
              {monthCells.map((d, i) => {
                if (!d) return <div key={`e${i}`} className="aspect-square" />;
                const k = keyOf(d);
                const has = (byDay.get(k) ?? []).length > 0;
                const isToday = k === todayKey;
                const isAbsent = absentSet.has(k);
                return (
                  <div key={k} className="aspect-square flex flex-col items-center justify-center gap-0.5 rounded" style={isToday ? { outline: "2px solid var(--pt-accent)", outlineOffset: "-2px" } : undefined}>
                    <span className="text-[10.5px]">{d.getDate()}</span>
                    {has && <span className="w-1 h-1 rounded-full" style={{ background: isAbsent ? "#b23b2a" : "var(--pt-accent)" }} />}
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setExpanded({ upcoming: false, past: false, mine: false })}
              className="mt-1.5 w-full rounded-md border border-black/[.10] px-3 py-1.5 text-[11.5px] font-semibold hover:bg-cream transition-colors"
              style={{ color: "var(--pt-accent)" }}
            >
              ⤢ Expand calendar
            </button>
          </div>
        ) : view === "month" ? (
          <div className="rounded-lg border border-black/[.08] bg-white overflow-hidden">
            <div className="grid grid-cols-7 border-b border-black/[.08]">
              {DOW.map((w) => <div key={w} className="text-center text-[9.5px] font-mono uppercase tracking-wide text-muted py-2">{w}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {monthCells.map((d, i) => {
                if (!d) return <div key={`e${i}`} className="min-h-[92px] border-b border-r border-black/[.04] bg-black/[.01]" />;
                const k = keyOf(d);
                const dayEvents = byDay.get(k) ?? [];
                const isToday = k === todayKey;
                return (
                  <div key={k} className="min-h-[92px] min-w-0 overflow-hidden border-b border-r border-black/[.04] p-1.5 flex flex-col gap-1">
                    <div className="text-[11px] font-semibold self-start px-1.5 rounded" style={isToday ? { background: "var(--pt-accent)", color: "var(--pt-on-accent)" } : undefined}>{d.getDate()}</div>
                    {dayEvents.slice(0, 3).map(chip)}
                    {dayEvents.length > 3 && <span className="text-[10px] text-muted px-1">+{dayEvents.length - 3} more</span>}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-black/[.08] bg-white overflow-hidden">
            <div className="grid grid-cols-7 border-b border-black/[.08]">
              {weekDays.map((d) => {
                const isToday = keyOf(d) === todayKey;
                return (
                  <div key={keyOf(d)} className="text-center py-2 border-r border-black/[.04] last:border-r-0">
                    <div className="text-[9.5px] font-mono uppercase tracking-wide text-muted">{DOW[d.getDay()]}</div>
                    <div className="mt-1"><span className="inline-grid place-items-center w-6 h-6 rounded-full text-[13px] font-semibold" style={isToday ? { background: "var(--pt-accent)", color: "var(--pt-on-accent)" } : undefined}>{d.getDate()}</span></div>
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-7">
              {weekDays.map((d) => {
                const k = keyOf(d);
                const dayEvents = byDay.get(k) ?? [];
                return (
                  <div key={k} className="min-h-[340px] min-w-0 overflow-hidden border-r border-black/[.04] last:border-r-0 p-1.5 flex flex-col gap-1">
                    {dayEvents.map(chip)}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Sections column */}
      <div className="flex flex-col gap-3 min-w-0">
        {sectionCard("upcoming", "Upcoming events", upcoming, {})}
        {sectionCard("past", "Past events", past, { badgeFor: (ev) => (absentSet.has(keyOf(new Date(ev.startsAt))) ? "absent" : "attended") })}
        {sectionCard("mine", "My events · attended", mine, { badgeFor: () => "attended" })}
      </div>

      {openEv && (
        <Overlay onClose={() => setOpenEv(null)}>
          <div className="flex flex-col gap-2">
            <h2 className="font-bold text-lg">{openEv.title}</h2>
            <div className="text-sm text-muted">{openEv.kind} · {new Date(openEv.startsAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</div>
            {openEv.location && <div className="text-sm text-muted">{openEv.location}</div>}
            {openEv.notes && <p className="text-sm mt-1">{openEv.notes}</p>}
            <div className="mt-2 flex flex-col gap-1.5">
              <span className="label text-[10px]">Going?</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setRsvps((r) => ({ ...r, [openEv.id]: "yes" }))} className="rounded-md px-4 py-2 text-[13px] font-semibold border" style={rsvps[openEv.id] === "yes" ? { background: "var(--pt-accent)", color: "var(--pt-on-accent)", borderColor: "transparent" } : { borderColor: "rgba(3,35,68,.15)", color: "#6B6058" }}>
                  Yes{rsvps[openEv.id] === "yes" ? " ✓" : ""}
                </button>
                <button type="button" onClick={() => setRsvps((r) => ({ ...r, [openEv.id]: "no" }))} className="rounded-md px-4 py-2 text-[13px] font-semibold border" style={rsvps[openEv.id] === "no" ? { background: "#44515f", color: "#fff", borderColor: "transparent" } : { borderColor: "rgba(3,35,68,.15)", color: "#6B6058" }}>
                  No{rsvps[openEv.id] === "no" ? " ✓" : ""}
                </button>
              </div>
              <span className="text-[11px] text-muted">
                {rsvps[openEv.id] === "yes" ? "You're marked as going." : rsvps[openEv.id] === "no" ? "Marked as not going." : "Let your chapter know if you'll be there."}
              </span>
            </div>
            <div className="flex justify-end mt-2">
              <button type="button" onClick={() => setOpenEv(null)} className="rounded-md px-4 py-2 text-[13px] font-semibold border border-black/15">Close</button>
            </div>
          </div>
        </Overlay>
      )}
    </div>
  );
}
