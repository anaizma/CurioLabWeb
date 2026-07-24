"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CalendarEvent, CalendarAudience, CalendarKind } from "@/lib/portal/director/calendar-data";

const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const AUD: { key: CalendarAudience; label: string }[] = [
  { key: "parent", label: "Parents" },
  { key: "mentor", label: "Mentors" },
  { key: "director", label: "Directors" },
];
const KINDS: CalendarKind[] = ["session", "orientation", "meeting", "other"];
type Repeat = "none" | "weekly" | "biweekly" | "monthly";
const inputCls = "w-full rounded-lg border border-ink/15 px-3 py-2 text-sm bg-white";

function keyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function timeOf(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function occurrences(start: Date, repeat: Repeat, until: Date | null): Date[] {
  if (repeat === "none" || !until) return [new Date(start)];
  const out: Date[] = [];
  const c = new Date(start);
  let g = 0;
  while (c.getTime() <= until.getTime() && g < 60) {
    out.push(new Date(c));
    if (repeat === "weekly") c.setDate(c.getDate() + 7);
    else if (repeat === "biweekly") c.setDate(c.getDate() + 14);
    else c.setMonth(c.getMonth() + 1);
    g++;
  }
  return out;
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: "rgba(3,35,68,.4)" }} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl max-h-[86vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function NewEventModal({ chapterId, dateKey, onClose, onDone }: { chapterId: string; dateKey: string; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<CalendarKind>("session");
  const [date, setDate] = useState(dateKey);
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("12:00");
  const [aud, setAud] = useState<Record<CalendarAudience, boolean>>({ parent: true, mentor: true, director: false });
  const [repeat, setRepeat] = useState<Repeat>("none");
  const [until, setUntil] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audiences = AUD.map((a) => a.key).filter((k) => aud[k]);
  const valid = title.trim().length > 0 && date.length > 0 && start.length > 0 && end.length > 0 && audiences.length > 0 && (repeat === "none" || until.length > 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const [sy, sm, sd] = date.split("-").map(Number);
      const startDate = new Date(sy, (sm || 1) - 1, sd || 1);
      const untilDate = until ? (() => { const [uy, um, ud] = until.split("-").map(Number); return new Date(uy, (um || 1) - 1, ud || 1); })() : null;
      const [sh, smin] = start.split(":").map(Number);
      const [eh, emin] = end.split(":").map(Number);
      const occ = occurrences(startDate, repeat, untilDate);
      for (const day of occ) {
        const startsAt = new Date(day);
        startsAt.setHours(sh || 0, smin || 0, 0, 0);
        const endsAt = new Date(day);
        endsAt.setHours(eh || 0, emin || 0, 0, 0);
        const res = await fetch("/api/ops/calendar", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chapterId, title: title.trim(), kind, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), audiences, location: location.trim() || undefined, notes: notes.trim() || undefined }),
        });
        if (!res.ok) {
          setError(res.status === 400 ? "Check the times — end must be after start." : res.status === 403 ? "You don't have permission." : "Could not create the event.");
          setBusy(false);
          return;
        }
      }
      onDone();
    } catch {
      setError("Network error — please try again.");
      setBusy(false);
    }
  }

  return (
    <Overlay onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <h2 className="font-bold text-lg">New event</h2>
        <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" autoFocus />
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs text-ink/60">Type
            <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as CalendarKind)}>
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink/60">Date
            <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs text-ink/60">Start
            <input type="time" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink/60">End
            <input type="time" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs text-ink/60">Repeat
            <select className={inputCls} value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)}>
              <option value="none">Does not repeat</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Every 2 weeks</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          {repeat !== "none" && (
            <label className="flex flex-col gap-1 text-xs text-ink/60">Until
              <input type="date" className={inputCls} value={until} onChange={(e) => setUntil(e.target.value)} />
            </label>
          )}
        </div>
        <div className="flex flex-col gap-1.5 text-xs text-ink/60">
          Who can see it
          <div className="flex gap-2 flex-wrap">
            {AUD.map((a) => {
              const on = aud[a.key];
              return (
                <button key={a.key} type="button" onClick={() => setAud((s) => ({ ...s, [a.key]: !s[a.key] }))}
                  className="rounded-full px-3 py-1 text-xs font-medium border"
                  style={on ? { background: "var(--pt-accent)", color: "var(--pt-on-accent)", borderColor: "transparent" } : { background: "#f7f4f0", color: "#6B6058", borderColor: "rgba(3,35,68,.12)" }}>
                  {a.label}
                </button>
              );
            })}
          </div>
        </div>
        <input className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location (optional)" />
        <textarea className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" />
        {error && <p className="text-xs" style={{ color: "var(--pt-accent-fg)" }}>{error}</p>}
        <div className="flex gap-2 justify-end mt-1">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold border border-ink/15">Cancel</button>
          <button type="submit" disabled={!valid || busy} className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50" style={{ background: "var(--pt-accent)", color: "var(--pt-on-accent)" }}>
            {busy ? "Publishing…" : repeat !== "none" ? "Publish series" : "Publish"}
          </button>
        </div>
      </form>
    </Overlay>
  );
}

function EventModal({ ev, canWrite, onClose, onDone }: { ev: CalendarEvent; canWrite: boolean; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  async function cancelEvent() {
    if (typeof window !== "undefined" && !window.confirm("Cancel this event? It drops off everyone's calendar.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/ops/calendar/${ev.id}`, { method: "DELETE" });
      if (res.ok) onDone();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Overlay onClose={onClose}>
      <div className="flex flex-col gap-2">
        <h2 className="font-bold text-lg">{ev.title}</h2>
        <div className="text-sm text-ink/60">{ev.kind} · {new Date(ev.startsAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</div>
        {ev.location && <div className="text-sm text-ink/60">{ev.location}</div>}
        <div className="flex gap-1.5 mt-1 flex-wrap">
          {ev.audiences.map((a) => (
            <span key={a} className="text-[10px] font-semibold rounded-full px-2 py-0.5" style={{ background: "var(--pt-accent-soft)", color: "var(--pt-accent-fg)" }}>{a}</span>
          ))}
        </div>
        {ev.notes && <p className="text-sm mt-1">{ev.notes}</p>}
        <div className="flex gap-2 justify-end mt-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold border border-ink/15">Close</button>
          {canWrite && (
            <button type="button" onClick={cancelEvent} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: "#B23B2A" }}>
              {busy ? "…" : "Cancel event"}
            </button>
          )}
        </div>
      </div>
    </Overlay>
  );
}

export default function CalendarClient({ chapterId, events }: { chapterId: string | null; events: CalendarEvent[] }) {
  const router = useRouter();
  const today = new Date();
  const [viewY, setViewY] = useState(today.getFullYear());
  const [viewM, setViewM] = useState(today.getMonth());
  const [modal, setModal] = useState<null | { type: "new"; dateKey: string } | { type: "event"; ev: CalendarEvent }>(null);

  const byDay = new Map<string, CalendarEvent[]>();
  events.forEach((e) => {
    const d = new Date(e.startsAt);
    if (isNaN(d.getTime())) return;
    const k = keyOf(d);
    const arr = byDay.get(k) ?? [];
    arr.push(e);
    byDay.set(k, arr);
  });

  const first = new Date(viewY, viewM, 1);
  const startPad = first.getDay();
  const days = new Date(viewY, viewM + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(new Date(viewY, viewM, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const canWrite = chapterId !== null;
  const todayKey = keyOf(today);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="text-lg font-bold">{MON[viewM]} {viewY}</div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { const d = new Date(viewY, viewM - 1, 1); setViewY(d.getFullYear()); setViewM(d.getMonth()); }} className="rounded-md border border-ink/15 w-8 h-8 text-sm">‹</button>
          <button type="button" onClick={() => { setViewY(today.getFullYear()); setViewM(today.getMonth()); }} className="rounded-md border border-ink/15 px-3 h-8 text-xs font-semibold">Today</button>
          <button type="button" onClick={() => { const d = new Date(viewY, viewM + 1, 1); setViewY(d.getFullYear()); setViewM(d.getMonth()); }} className="rounded-md border border-ink/15 w-8 h-8 text-sm">›</button>
        </div>
      </div>
      {!canWrite && <p className="text-xs text-ink/50">Sign in as a Chapter Director to create events.</p>}

      <div className="rounded-xl border border-ink/10 bg-white overflow-hidden">
        <div className="grid grid-cols-7 border-b border-ink/10">
          {DOW.map((w) => <div key={w} className="text-center text-[10px] font-mono uppercase tracking-wide text-ink/40 py-2">{w}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            if (!d) return <div key={`e${i}`} className="min-h-[94px] border-b border-r border-ink/5 bg-black/[.01]" />;
            const k = keyOf(d);
            const dayEvents = byDay.get(k) ?? [];
            const isToday = k === todayKey;
            return (
              <div key={k} onClick={() => canWrite && setModal({ type: "new", dateKey: k })}
                className={`min-h-[94px] border-b border-r border-ink/5 p-1.5 flex flex-col gap-1 ${canWrite ? "cursor-pointer hover:bg-cream transition-colors" : ""}`}>
                <div className="text-[11px] font-semibold self-start px-1.5 rounded" style={isToday ? { background: "var(--pt-accent)", color: "var(--pt-on-accent)" } : undefined}>{d.getDate()}</div>
                {dayEvents.slice(0, 3).map((ev) => (
                  <button key={ev.id} type="button" onClick={(e) => { e.stopPropagation(); setModal({ type: "event", ev }); }}
                    className="text-left text-[10.5px] rounded px-1.5 py-0.5 truncate w-full" style={{ background: "var(--pt-accent-soft)", color: "var(--pt-accent-fg)" }}>
                    {timeOf(ev.startsAt)} {ev.title}
                  </button>
                ))}
                {dayEvents.length > 3 && <span className="text-[10px] text-ink/40 px-1">+{dayEvents.length - 3} more</span>}
              </div>
            );
          })}
        </div>
      </div>

      {modal?.type === "new" && chapterId && (
        <NewEventModal chapterId={chapterId} dateKey={modal.dateKey} onClose={() => setModal(null)} onDone={() => { setModal(null); router.refresh(); }} />
      )}
      {modal?.type === "event" && (
        <EventModal ev={modal.ev} canWrite={canWrite} onClose={() => setModal(null)} onDone={() => { setModal(null); router.refresh(); }} />
      )}
    </div>
  );
}
