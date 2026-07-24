"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { CalendarEvent, CalendarAudience, CalendarKind } from "@/lib/portal/director/calendar-data";

const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WD_SHORT = ["S", "M", "T", "W", "T", "F", "S"];
const WD_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const AUD: { key: CalendarAudience; label: string }[] = [
  { key: "parent", label: "Parents" },
  { key: "mentor", label: "Mentors" },
  { key: "director", label: "Directors" },
];
const CAT_LABEL: Record<CalendarAudience, string> = { parent: "Parents", mentor: "Mentors", director: "Directors" };
const MENTOR_ROLES = ["junior_mentor", "senior_instructor", "lead_instructor"];
const KINDS: CalendarKind[] = ["session", "orientation", "meeting", "other"];
type Unit = "day" | "week" | "month" | "year";
type Ends = "never" | "on" | "after";
type Freq = "none" | "daily" | "weekly" | "monthly" | "custom";
interface RecCfg { interval: number; unit: Unit; weekdays: number[]; ends: Ends; endDate: string; count: number; }
type GuestEntry = { kind: "all"; cat: CalendarAudience } | { kind: "person"; cat: CalendarAudience; name: string };
const UNIT_ADV: Record<Unit, string> = { day: "Daily", week: "Weekly", month: "Monthly", year: "Yearly" };
const inputCls = "w-full rounded-lg border border-ink/15 px-3 py-2 text-sm bg-white";

function keyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function timeOf(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function cfgFor(freq: Freq, startWd: number): RecCfg {
  if (freq === "daily") return { interval: 1, unit: "day", weekdays: [], ends: "never", endDate: "", count: 13 };
  if (freq === "weekly") return { interval: 1, unit: "week", weekdays: [startWd], ends: "never", endDate: "", count: 13 };
  if (freq === "monthly") return { interval: 1, unit: "month", weekdays: [], ends: "never", endDate: "", count: 13 };
  return { interval: 1, unit: "week", weekdays: [startWd], ends: "never", endDate: "", count: 13 };
}
function expand(start: Date, cfg: RecCfg): Date[] {
  const out: Date[] = [];
  const CAP = 200;
  const NEVER = 60;
  const s0 = new Date(start);
  s0.setHours(0, 0, 0, 0);
  const endD =
    cfg.ends === "on" && cfg.endDate
      ? (() => {
          const [y, m, d] = cfg.endDate.split("-").map(Number);
          const e = new Date(y, (m || 1) - 1, d || 1);
          e.setHours(23, 59, 59, 999);
          return e;
        })()
      : null;
  if (cfg.unit === "week") {
    const days = (cfg.weekdays.length ? cfg.weekdays : [s0.getDay()]).slice().sort((a, b) => a - b);
    const weekStart = new Date(s0);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    let occ = 0;
    while (out.length < CAP) {
      for (const wd of days) {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + wd);
        d.setHours(0, 0, 0, 0);
        if (d.getTime() < s0.getTime()) continue;
        if (endD && d.getTime() > endD.getTime()) return out;
        out.push(new Date(d));
        occ++;
        if (cfg.ends === "after" && occ >= cfg.count) return out;
        if (cfg.ends === "never" && occ >= NEVER) return out;
      }
      weekStart.setDate(weekStart.getDate() + 7 * Math.max(1, cfg.interval));
    }
    return out;
  }
  const c = new Date(s0);
  let occ = 0;
  while (out.length < CAP) {
    if (endD && c.getTime() > endD.getTime()) break;
    out.push(new Date(c));
    occ++;
    if (cfg.ends === "after" && occ >= cfg.count) break;
    if (cfg.ends === "never" && occ >= NEVER) break;
    const step = Math.max(1, cfg.interval);
    if (cfg.unit === "day") c.setDate(c.getDate() + step);
    else if (cfg.unit === "month") c.setMonth(c.getMonth() + step);
    else c.setFullYear(c.getFullYear() + step);
  }
  return out;
}
function summarize(cfg: RecCfg): string {
  let s = cfg.interval > 1 ? `Every ${cfg.interval} ${cfg.unit}s` : UNIT_ADV[cfg.unit];
  if (cfg.unit === "week" && cfg.weekdays.length) s += " on " + cfg.weekdays.slice().sort((a, b) => a - b).map((w) => WD_LABEL[w]).join(", ");
  if (cfg.ends === "on" && cfg.endDate) s += `, until ${cfg.endDate}`;
  else if (cfg.ends === "after") s += `, ${cfg.count} times`;
  return s;
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

function CustomRecurrenceModal({ initial, startWeekday, onCancel, onDone }: { initial: RecCfg; startWeekday: number; onCancel: () => void; onDone: (cfg: RecCfg) => void }) {
  const [interval, setIntervalV] = useState(initial.interval);
  const [unit, setUnit] = useState<Unit>(initial.unit);
  const [weekdays, setWeekdays] = useState<number[]>(initial.weekdays.length ? initial.weekdays : [startWeekday]);
  const [ends, setEnds] = useState<Ends>(initial.ends);
  const [endDate, setEndDate] = useState(initial.endDate);
  const [count, setCount] = useState(initial.count);
  function toggleWd(w: number) {
    setWeekdays((prev) => (prev.includes(w) ? prev.filter((x) => x !== w) : [...prev, w]));
  }
  return (
    <Overlay onClose={onCancel}>
      <div className="flex flex-col gap-4">
        <h2 className="font-bold text-lg">Custom recurrence</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-ink/70">Repeat every</span>
          <input type="number" min={1} value={interval} onChange={(e) => setIntervalV(Math.max(1, Number(e.target.value) || 1))} className="w-16 rounded-lg border border-ink/15 px-2 py-1.5 text-sm bg-white" />
          <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)} className="rounded-lg border border-ink/15 px-2 py-1.5 text-sm bg-white">
            <option value="day">day</option>
            <option value="week">week</option>
            <option value="month">month</option>
            <option value="year">year</option>
          </select>
        </div>
        {unit === "week" && (
          <div className="flex flex-col gap-2">
            <span className="text-sm text-ink/70">Repeat on</span>
            <div className="flex gap-1.5">
              {WD_SHORT.map((lbl, w) => {
                const on = weekdays.includes(w);
                return (
                  <button key={w} type="button" onClick={() => toggleWd(w)} className="w-9 h-9 rounded-full text-xs font-semibold" style={on ? { background: "var(--pt-accent)", color: "var(--pt-on-accent)" } : { background: "#eef0f2", color: "#556" }}>
                    {lbl}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="flex flex-col gap-2">
          <span className="text-sm text-ink/70">Ends</span>
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="ends" checked={ends === "never"} onChange={() => setEnds("never")} /> Never</label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="ends" checked={ends === "on"} onChange={() => setEnds("on")} /> On
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={ends !== "on"} className="rounded-lg border border-ink/15 px-2 py-1 text-sm bg-white disabled:opacity-50" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="ends" checked={ends === "after"} onChange={() => setEnds("after")} /> After
            <input type="number" min={1} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))} disabled={ends !== "after"} className="w-16 rounded-lg border border-ink/15 px-2 py-1 text-sm bg-white disabled:opacity-50" /> occurrences
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-1">
          <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border border-ink/15">Cancel</button>
          <button type="button" onClick={() => onDone({ interval, unit, weekdays, ends, endDate, count })} className="rounded-lg px-4 py-2 text-sm font-semibold" style={{ background: "var(--pt-accent)", color: "var(--pt-on-accent)" }}>Done</button>
        </div>
      </div>
    </Overlay>
  );
}

function NewEventModal({ chapterId, dateKey, onClose, onDone }: { chapterId: string; dateKey: string; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<CalendarKind>("session");
  const [date, setDate] = useState(dateKey);
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("12:00");
  const [freq, setFreq] = useState<Freq>("none");
  const [custom, setCustom] = useState<RecCfg | null>(null);
  const [showCustom, setShowCustom] = useState(false);
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GuestEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [menuCat, setMenuCat] = useState<CalendarAudience | null>(null);
  const [members, setMembers] = useState<Record<string, string[]>>({});
  const guestRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (guestRef.current && !guestRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const startWeekday = (() => { const p = date.split("-").map(Number); return isNaN(p[0]) ? new Date().getDay() : new Date(p[0], (p[1] || 1) - 1, p[2] || 1).getDay(); })();
  const valid = title.trim().length > 0 && date.length > 0 && start.length > 0 && end.length > 0 && selected.length > 0;

  function onRepeatChange(v: string) {
    if (v === "custom") { setShowCustom(true); return; }
    setFreq(v as Freq);
    setCustom(null);
  }
  async function loadCat(cat: CalendarAudience) {
    if (members[cat]) return;
    try {
      if (cat === "parent") {
        const res = await fetch("/api/ops/guardianships", { cache: "no-store" });
        if (res.ok) {
          const d = (await res.json()) as { items?: { guardianDisplayName?: string }[] };
          const names = Array.from(new Set((d.items ?? []).map((g) => g.guardianDisplayName).filter((x): x is string => Boolean(x))));
          setMembers((m) => ({ ...m, parent: names }));
        }
      } else {
        const res = await fetch("/api/ops/memberships", { cache: "no-store" });
        if (res.ok) {
          const d = (await res.json()) as { items?: { displayName?: string; role?: string }[] };
          const names = (d.items ?? [])
            .filter((x) => (cat === "director" ? x.role === "chapter_director" : MENTOR_ROLES.includes(x.role ?? "")))
            .map((x) => x.displayName)
            .filter((x): x is string => Boolean(x));
          setMembers((m) => ({ ...m, [cat]: Array.from(new Set(names)) }));
        }
      }
    } catch {
      /* ignore */
    }
  }
  function selectCat(cat: CalendarAudience) {
    setMenuCat(cat);
    void loadCat(cat);
  }
  function addAll(cat: CalendarAudience) {
    setSelected((p) => (p.some((s) => s.kind === "all" && s.cat === cat) ? p : [...p.filter((s) => !(s.kind === "person" && s.cat === cat)), { kind: "all", cat }]));
  }
  function addPerson(cat: CalendarAudience, name: string) {
    setSelected((p) => (p.some((s) => s.kind === "person" && s.name === name) ? p : [...p, { kind: "person", cat, name }]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const [sy, sm, sd] = date.split("-").map(Number);
      const startDate = new Date(sy, (sm || 1) - 1, sd || 1);
      const [sh, smin] = start.split(":").map(Number);
      const [eh, emin] = end.split(":").map(Number);
      const audiences = Array.from(new Set(selected.filter((s) => s.kind === "all").map((s) => s.cat)));
      const guests = selected.filter((s): s is Extract<GuestEntry, { kind: "person" }> => s.kind === "person").map((s) => s.name);
      let dates: Date[];
      if (freq === "none") dates = [startDate];
      else if (freq === "custom" && custom) dates = expand(startDate, custom);
      else dates = expand(startDate, cfgFor(freq, startDate.getDay()));
      for (const day of dates) {
        const startsAt = new Date(day);
        startsAt.setHours(sh || 0, smin || 0, 0, 0);
        const endsAt = new Date(day);
        endsAt.setHours(eh || 0, emin || 0, 0, 0);
        const res = await fetch("/api/ops/calendar", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chapterId, title: title.trim(), kind, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), audiences, guests: guests.length ? guests : undefined, location: location.trim() || undefined, notes: notes.trim() || undefined }),
        });
        if (!res.ok) {
          setError(res.status === 400 ? "Check the fields — pick at least one guest and make sure end is after start." : res.status === 403 ? "You don't have permission." : "Could not create the event.");
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

  const allOn = menuCat ? selected.some((s) => s.kind === "all" && s.cat === menuCat) : false;

  return (
    <>
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
          <label className="flex flex-col gap-1 text-xs text-ink/60">Repeat
            <select className={inputCls} value={freq} onChange={(e) => onRepeatChange(e.target.value)}>
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="custom">Custom…</option>
            </select>
          </label>
          {freq === "custom" && custom && (
            <div className="flex items-center justify-between gap-2 text-xs -mt-1">
              <span style={{ color: "var(--pt-accent-fg)" }}>{summarize(custom)}</span>
              <button type="button" onClick={() => setShowCustom(true)} className="font-semibold" style={{ color: "var(--pt-accent)" }}>Edit</button>
            </div>
          )}

          <div className="flex flex-col gap-1.5 text-xs text-ink/60">
            Add guests
            <div className="relative" ref={guestRef}>
              <button type="button" onClick={() => { setOpen((o) => !o); setMenuCat(null); }} className={inputCls + " text-left flex items-center justify-between"}>
                <span className={selected.length ? "text-ink" : "text-ink/40"}>{selected.length ? `${selected.length} added` : "Add mentors, parents, or directors…"}</span>
                <span className="text-ink/40">▾</span>
              </button>
              {open && (
                <div className="absolute z-10 mt-1 w-full rounded-lg border border-ink/15 bg-white shadow-lg max-h-56 overflow-y-auto">
                  {menuCat === null ? (
                    AUD.map((a) => (
                      <button key={a.key} type="button" onClick={() => selectCat(a.key)} className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-cream">
                        {a.label}<span className="text-ink/30">›</span>
                      </button>
                    ))
                  ) : (
                    <>
                      <button type="button" onClick={() => setMenuCat(null)} className="flex w-full items-center gap-2 px-3 py-2 text-xs text-ink/50 border-b border-ink/5">‹ Back</button>
                      <button type="button" disabled={allOn} onClick={() => addAll(menuCat)} className="flex w-full items-center px-3 py-2 text-sm font-semibold hover:bg-cream disabled:opacity-50" style={{ color: "var(--pt-accent-fg)" }}>
                        All {CAT_LABEL[menuCat].toLowerCase()}{allOn ? " ✓" : ""}
                      </button>
                      {(members[menuCat] ?? []).length === 0 ? (
                        <div className="px-3 py-2 text-xs text-ink/40">No members to show (sign in as a director).</div>
                      ) : (
                        (members[menuCat] ?? []).map((n) => {
                          const on = selected.some((s) => s.kind === "person" && s.name === n);
                          const dis = on || allOn;
                          return (
                            <button key={n} type="button" disabled={dis} onClick={() => addPerson(menuCat, n)} className="block w-full text-left px-3 py-2 text-sm hover:bg-cream disabled:text-ink/30 disabled:hover:bg-transparent">
                              {n}{on ? " ✓" : ""}
                            </button>
                          );
                        })
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
            {selected.length > 0 && (
              <div className="flex flex-col gap-0.5 mt-1">
                {selected.map((s, i) => {
                  const isAll = s.kind === "all";
                  const label = isAll ? `All ${CAT_LABEL[s.cat].toLowerCase()}` : s.name;
                  const initial = (isAll ? CAT_LABEL[s.cat].charAt(0) : (s.name.trim().charAt(0) || "?")).toUpperCase();
                  return (
                    <div key={i} className="flex items-center gap-2.5 py-1">
                      <div className="w-7 h-7 rounded-full grid place-items-center text-[11px] font-semibold text-white shrink-0" style={{ background: isAll ? "var(--pt-accent)" : "#7c8aa0" }}>{initial}</div>
                      <span className={`flex-1 text-sm ${isAll ? "font-bold" : ""}`}>{label}</span>
                      <button type="button" onClick={() => setSelected((p) => p.filter((_, idx) => idx !== i))} className="text-ink/30 hover:text-ink/70 text-base leading-none px-1">×</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <input className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location (optional)" />
          <textarea className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" />
          {error && <p className="text-xs" style={{ color: "var(--pt-accent-fg)" }}>{error}</p>}
          <div className="flex gap-2 justify-end mt-1">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold border border-ink/15">Cancel</button>
            <button type="submit" disabled={!valid || busy} className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50" style={{ background: "var(--pt-accent)", color: "var(--pt-on-accent)" }}>
              {busy ? "Saving…" : freq !== "none" ? "Save series" : "Save"}
            </button>
          </div>
        </form>
      </Overlay>
      {showCustom && (
        <CustomRecurrenceModal
          initial={custom ?? cfgFor("weekly", startWeekday)}
          startWeekday={startWeekday}
          onCancel={() => setShowCustom(false)}
          onDone={(cfg) => { setCustom(cfg); setFreq("custom"); setShowCustom(false); }}
        />
      )}
    </>
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

function EventChip({ ev, onOpen }: { ev: CalendarEvent; onOpen: () => void }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }} className="block w-full min-w-0 text-left text-[10.5px] rounded px-1.5 py-0.5 truncate" style={{ background: "var(--pt-accent-soft)", color: "var(--pt-accent-fg)" }}>
      {timeOf(ev.startsAt)} {ev.title}
    </button>
  );
}

export default function CalendarClient({ chapterId, events }: { chapterId: string | null; events: CalendarEvent[] }) {
  const router = useRouter();
  const today = new Date();
  const [cursor, setCursor] = useState(today);
  const [view, setView] = useState<"month" | "week">("month");
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
  byDay.forEach((arr) => arr.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()));

  const canWrite = chapterId !== null;
  const todayKey = keyOf(today);

  function go(delta: number) {
    if (view === "month") setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1));
    else { const d = new Date(cursor); d.setDate(d.getDate() + delta * 7); setCursor(d); }
  }

  const weekStart = new Date(cursor);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekDays = Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; });
  const weekEnd = weekDays[6];
  const label = view === "month"
    ? `${MON[cursor.getMonth()]} ${cursor.getFullYear()}`
    : `${MON[weekStart.getMonth()].slice(0, 3)} ${weekStart.getDate()} – ${weekStart.getMonth() !== weekEnd.getMonth() ? MON[weekEnd.getMonth()].slice(0, 3) + " " : ""}${weekEnd.getDate()}`;

  const mFirst = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const mPad = mFirst.getDay();
  const mDays = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const monthCells: (Date | null)[] = [];
  for (let i = 0; i < mPad; i++) monthCells.push(null);
  for (let d = 1; d <= mDays; d++) monthCells.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));
  while (monthCells.length % 7 !== 0) monthCells.push(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-lg font-bold">{label}</div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-ink/15 overflow-hidden text-xs font-semibold">
            <button type="button" onClick={() => setView("month")} className="px-3 h-8" style={view === "month" ? { background: "var(--pt-accent)", color: "var(--pt-on-accent)" } : undefined}>Month</button>
            <button type="button" onClick={() => setView("week")} className="px-3 h-8 border-l border-ink/15" style={view === "week" ? { background: "var(--pt-accent)", color: "var(--pt-on-accent)" } : undefined}>Week</button>
          </div>
          <button type="button" onClick={() => go(-1)} className="rounded-md border border-ink/15 w-8 h-8 text-sm">‹</button>
          <button type="button" onClick={() => setCursor(new Date())} className="rounded-md border border-ink/15 px-3 h-8 text-xs font-semibold">Today</button>
          <button type="button" onClick={() => go(1)} className="rounded-md border border-ink/15 w-8 h-8 text-sm">›</button>
        </div>
      </div>
      {!canWrite && <p className="text-xs text-ink/50">Sign in as a Chapter Director to create events.</p>}

      {view === "month" ? (
        <div className="rounded-xl border border-ink/10 bg-white overflow-hidden">
          <div className="grid grid-cols-7 border-b border-ink/10">
            {DOW.map((w) => <div key={w} className="text-center text-[10px] font-mono uppercase tracking-wide text-ink/40 py-2">{w}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {monthCells.map((d, i) => {
              if (!d) return <div key={`e${i}`} className="min-h-[94px] border-b border-r border-ink/5 bg-black/[.01]" />;
              const k = keyOf(d);
              const dayEvents = byDay.get(k) ?? [];
              const isToday = k === todayKey;
              return (
                <div key={k} onClick={() => canWrite && setModal({ type: "new", dateKey: k })} className={`min-h-[94px] min-w-0 overflow-hidden border-b border-r border-ink/5 p-1.5 flex flex-col gap-1 ${canWrite ? "cursor-pointer hover:bg-cream transition-colors" : ""}`}>
                  <div className="text-[11px] font-semibold self-start px-1.5 rounded" style={isToday ? { background: "var(--pt-accent)", color: "var(--pt-on-accent)" } : undefined}>{d.getDate()}</div>
                  {dayEvents.slice(0, 3).map((ev) => <EventChip key={ev.id} ev={ev} onOpen={() => setModal({ type: "event", ev })} />)}
                  {dayEvents.length > 3 && <span className="text-[10px] text-ink/40 px-1">+{dayEvents.length - 3} more</span>}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-ink/10 bg-white overflow-hidden">
          <div className="grid grid-cols-7 border-b border-ink/10">
            {weekDays.map((d) => {
              const isToday = keyOf(d) === todayKey;
              return (
                <div key={keyOf(d)} className="text-center py-2 border-r border-ink/5 last:border-r-0">
                  <div className="text-[10px] font-mono uppercase tracking-wide text-ink/40">{DOW[d.getDay()]}</div>
                  <div className="mt-1"><span className="inline-grid place-items-center w-6 h-6 rounded-full text-sm font-semibold" style={isToday ? { background: "var(--pt-accent)", color: "var(--pt-on-accent)" } : undefined}>{d.getDate()}</span></div>
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-7">
            {weekDays.map((d) => {
              const k = keyOf(d);
              const dayEvents = byDay.get(k) ?? [];
              return (
                <div key={k} onClick={() => canWrite && setModal({ type: "new", dateKey: k })} className={`min-h-[380px] min-w-0 overflow-hidden border-r border-ink/5 last:border-r-0 p-1.5 flex flex-col gap-1 ${canWrite ? "cursor-pointer hover:bg-cream transition-colors" : ""}`}>
                  {dayEvents.map((ev) => <EventChip key={ev.id} ev={ev} onOpen={() => setModal({ type: "event", ev })} />)}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {modal?.type === "new" && chapterId && (
        <NewEventModal chapterId={chapterId} dateKey={modal.dateKey} onClose={() => setModal(null)} onDone={() => { setModal(null); router.refresh(); }} />
      )}
      {modal?.type === "event" && (
        <EventModal ev={modal.ev} canWrite={canWrite} onClose={() => setModal(null)} onDone={() => { setModal(null); router.refresh(); }} />
      )}
    </div>
  );
}
