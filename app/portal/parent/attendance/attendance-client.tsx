"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type AbsentRec = { type: "absent"; reason: string; slots: string[] };
type LateRec = { type: "late"; arrive: string };
type Rec = AbsentRec | LateRec;

interface LiveSession {
  eventId: string;
  startsAt: string;
}

const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const COLOR = {
  session: { dot: "#2F7A4D", soft: "#E7F2EA" },
  absent: { dot: "#B23B2A", soft: "#FBE3DF" },
  late: { dot: "#B8860B", soft: "#FCF1D6" },
};

function keyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fromKey(k: string): Date {
  return new Date(k + "T12:00:00");
}

export default function AttendanceClient({
  childName,
  childId,
  sessions,
  existing,
  counts,
  live,
}: {
  childName: string;
  childId: string | null;
  sessions: LiveSession[];
  existing: { sessionEventId: string; type: "absent" | "late" }[];
  counts: { totalAbsences: number; outstanding: number; madeUp: number; late: number };
  live: boolean;
}) {
  const router = useRouter();
  const now = new Date();
  const calY = now.getFullYear();
  const calM = now.getMonth();
  const todayKey = keyOf(now);

  const liveSessions = live
    ? sessions
        .map((s) => ({ eventId: s.eventId, date: new Date(s.startsAt) }))
        .filter((s) => !isNaN(s.date.getTime()))
        .sort((a, b) => a.date.getTime() - b.date.getTime())
    : [];
  const sessionByKey = new Map(liveSessions.map((s) => [keyOf(s.date), s]));
  const eventKeyById = new Map(liveSessions.map((s) => [s.eventId, keyOf(s.date)]));

  const [records, setRecords] = useState<Record<string, Rec>>(() => {
    if (!live) return {};
    const init: Record<string, Rec> = {};
    existing.forEach((x) => {
      const k = eventKeyById.get(x.sessionEventId);
      if (!k) return;
      init[k] = x.type === "late" ? { type: "late", arrive: "" } : { type: "absent", reason: "", slots: [] };
    });
    return init;
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"absent" | "late" | null>(null);
  const [reason, setReason] = useState("");
  const [consent, setConsent] = useState(false);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [arrive, setArrive] = useState("10:30");
  const [busy, setBusy] = useState(false);

  function isSession(d: Date): boolean {
    return live ? sessionByKey.has(keyOf(d)) : d.getDay() === 6;
  }
  function nextSessionDate(from: Date): Date | null {
    if (live) {
      const n = liveSessions.find((s) => s.date.getTime() > from.getTime());
      return n ? n.date : null;
    }
    const c = new Date(from);
    do {
      c.setDate(c.getDate() + 1);
    } while (c.getDay() !== 6);
    return c;
  }

  function slotOptions(sel: Date): { label: string; value: string }[] {
    const ns = nextSessionDate(sel);
    const out: { label: string; value: string }[] = [];
    const c = new Date(sel);
    c.setDate(c.getDate() + 1);
    c.setHours(16, 0, 0, 0);
    let guard = 0;
    while ((!ns || c.getTime() < ns.getTime()) && out.length < 4 && guard < 14) {
      const lbl = `${DOW[c.getDay()]} ${MON[c.getMonth()].slice(0, 3)} ${c.getDate()}`;
      out.push({ label: `${lbl} · 4:00 PM`, value: live ? c.toISOString() : `${lbl} · 4:00 PM` });
      const c2 = new Date(c);
      c2.setHours(19, 0, 0, 0);
      if (!ns || c2.getTime() < ns.getTime()) out.push({ label: `${lbl} · 7:00 PM`, value: live ? c2.toISOString() : `${lbl} · 7:00 PM` });
      c.setDate(c.getDate() + 1);
      c.setHours(16, 0, 0, 0);
      guard++;
    }
    if (out.length === 0 && ns) {
      const m = new Date(ns.getTime() - 30 * 60 * 1000);
      const lbl = `${DOW[m.getDay()]} ${MON[m.getMonth()].slice(0, 3)} ${m.getDate()} · before session`;
      out.push({ label: lbl, value: live ? m.toISOString() : lbl });
    }
    return out.slice(0, 5);
  }

  function openDay(k: string) {
    setSelected(k);
    const r = records[k];
    if (r) {
      setMode(r.type);
      if (r.type === "late") setArrive(r.arrive || "10:30");
      if (r.type === "absent") {
        setReason(r.reason);
        setConsent(true);
        const c: Record<string, boolean> = {};
        r.slots.forEach((s) => (c[s] = true));
        setChosen(c);
      }
    } else {
      setMode(null);
      setReason("");
      setConsent(false);
      setChosen({});
      setArrive("10:30");
    }
  }
  function close() {
    setSelected(null);
    setMode(null);
  }

  async function saveLate() {
    if (!selected) return;
    if (live && childId) {
      const sess = sessionByKey.get(selected);
      if (!sess) return;
      setBusy(true);
      try {
        const d = fromKey(selected);
        const parts = arrive.split(":");
        d.setHours(Number(parts[0]) || 0, Number(parts[1]) || 0, 0, 0);
        const res = await fetch(`/api/guardian/children/${childId}/attendance`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionEventId: sess.eventId, type: "late", arriveAt: d.toISOString() }),
        });
        if (res.ok) {
          close();
          router.refresh();
        }
      } finally {
        setBusy(false);
      }
      return;
    }
    setRecords((m) => ({ ...m, [selected]: { type: "late", arrive } }));
    close();
  }

  async function saveAbsent() {
    if (!selected) return;
    const slots = Object.keys(chosen).filter((s) => chosen[s]);
    if (live && childId) {
      const sess = sessionByKey.get(selected);
      if (!sess) return;
      setBusy(true);
      try {
        const res = await fetch(`/api/guardian/children/${childId}/attendance`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionEventId: sess.eventId, type: "absent", reason: reason.trim(), makeupConsent: true, makeupSlots: slots }),
        });
        if (res.ok) {
          close();
          router.refresh();
        }
      } finally {
        setBusy(false);
      }
      return;
    }
    setRecords((m) => ({ ...m, [selected]: { type: "absent", reason: reason.trim(), slots } }));
    close();
  }

  const absCount = live ? counts.totalAbsences : Object.values(records).filter((r) => r.type === "absent").length;
  const lateCount = live ? counts.late : Object.values(records).filter((r) => r.type === "late").length;

  const first = new Date(calY, calM, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(calY, calM + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(calY, calM, d));

  const sel = selected ? fromKey(selected) : null;
  const ns = sel ? nextSessionDate(sel) : null;
  const nsLabel = ns ? `${DOW[ns.getDay()]}, ${MON[ns.getMonth()]} ${ns.getDate()}` : "the end of the term";
  const slots = sel ? slotOptions(sel) : [];
  const absentValid = Boolean(reason.trim()) && consent && Object.values(chosen).some(Boolean);
  const orderedKeys = Object.keys(records).sort();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-3 flex-wrap">
        <div className="flex-1 min-w-28 rounded-xl border border-ink/10 bg-white p-3">
          <div className="text-2xl font-bold" style={{ color: COLOR.absent.dot }}>{absCount}</div>
          <div className="text-xs text-ink/50">absences this term</div>
        </div>
        <div className="flex-1 min-w-28 rounded-xl border border-ink/10 bg-white p-3">
          <div className="text-2xl font-bold" style={{ color: COLOR.late.dot }}>{lateCount}</div>
          <div className="text-xs text-ink/50">late arrivals</div>
        </div>
      </div>

      <div className="rounded-xl border border-ink/10 bg-white p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">{MON[calM]} {calY}</div>
          <div className="flex gap-3 text-[11px] text-ink/50 flex-wrap">
            <span><span className="inline-block w-2.5 h-2.5 rounded-full align-middle mr-1" style={{ background: COLOR.session.dot }} />Session</span>
            <span><span className="inline-block w-2.5 h-2.5 rounded-full align-middle mr-1" style={{ background: COLOR.absent.dot }} />Absent</span>
            <span><span className="inline-block w-2.5 h-2.5 rounded-full align-middle mr-1" style={{ background: COLOR.late.dot }} />Late</span>
          </div>
        </div>
        {live && liveSessions.length === 0 && (
          <p className="text-xs text-ink/50">No sessions on the chapter calendar yet — they&apos;ll appear here once your director publishes them.</p>
        )}
        <div className="grid grid-cols-7 gap-1.5">
          {DOW.map((w) => (
            <div key={w} className="text-center text-[10px] font-mono uppercase tracking-wide text-ink/40 py-1">{w}</div>
          ))}
          {cells.map((d, i) => {
            if (!d) return <div key={`e${i}`} />;
            const k = keyOf(d);
            const sess = isSession(d);
            const rec = records[k];
            const isToday = k === todayKey;
            const isSel = k === selected;
            let bg = "transparent";
            let dotColor = "";
            let showDot = false;
            if (sess) { bg = COLOR.session.soft; dotColor = COLOR.session.dot; showDot = true; }
            if (rec?.type === "absent") { bg = COLOR.absent.soft; dotColor = COLOR.absent.dot; showDot = true; }
            if (rec?.type === "late") { bg = COLOR.late.soft; dotColor = COLOR.late.dot; showDot = true; }
            return (
              <button
                key={k}
                type="button"
                disabled={!sess}
                onClick={() => sess && openDay(k)}
                className={`aspect-square rounded-lg border text-sm flex flex-col items-center justify-center gap-1 ${sess ? "cursor-pointer hover:brightness-95" : "cursor-default"}`}
                style={{
                  background: bg,
                  borderColor: isSel ? dotColor : rec ? "transparent" : sess ? COLOR.session.dot + "55" : "rgba(3,35,68,.06)",
                  outline: isToday ? "2px solid var(--pt-accent)" : undefined,
                  outlineOffset: isToday ? "-2px" : undefined,
                }}
              >
                <span className={rec ? "font-semibold" : ""}>{d.getDate()}</span>
                {showDot && <span className="w-1.5 h-1.5 rounded-full" style={{ background: dotColor }} />}
              </button>
            );
          })}
        </div>
      </div>

      {sel && (
        <div className="rounded-xl border border-ink/10 bg-white p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">{DOW[sel.getDay()]}, {MON[sel.getMonth()]} {sel.getDate()} · session</div>
            <button type="button" onClick={close} className="text-xs font-semibold text-ink/50">Close</button>
          </div>
          <div className="flex gap-2">
            {(["absent", "late"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setMode(t)}
                className="flex-1 rounded-lg border px-3 py-2 text-sm font-semibold"
                style={mode === t ? { background: "var(--pt-accent-soft)", borderColor: "var(--pt-accent-border)", color: "var(--pt-accent-fg)" } : { background: "#f7f4f0", borderColor: "rgba(3,35,68,.10)", color: "#6B6058" }}
              >
                {t === "absent" ? "Absent" : "Arriving late"}
              </button>
            ))}
          </div>

          {mode === "late" && (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-ink/60">When will {childName} arrive?</span>
                <input type="time" value={arrive} onChange={(e) => setArrive(e.target.value)} className="rounded-lg border border-ink/15 px-3 py-2 text-sm bg-white" />
              </label>
              <button type="button" onClick={saveLate} disabled={busy} className="self-start rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50" style={{ background: "var(--pt-accent)", color: "var(--pt-on-accent)" }}>
                {busy ? "Saving…" : "Save late notice"}
              </button>
            </div>
          )}

          {mode === "absent" && (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-ink/60">Why will {childName} be absent?</span>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="A short note is all we need." className="rounded-lg border border-ink/15 px-3 py-2 text-sm bg-white min-h-16" />
              </label>
              <label className="flex gap-2 items-start text-xs text-ink">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
                <span>I consent to {childName} making up this session with a <b>30-minute virtual check-in</b>, completed after {childName} finishes the session&apos;s assignment.</span>
              </label>
              <div className="flex flex-col gap-1.5 text-sm">
                <span className="text-ink/60">Pick times you&apos;re available for the check-in. It must be completed <b>before the next session</b> ({nsLabel}).</span>
                <div className="flex flex-wrap gap-2">
                  {slots.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setChosen((c) => ({ ...c, [s.value]: !c[s.value] }))}
                      className="rounded-full px-3 py-1.5 text-xs font-medium border"
                      style={chosen[s.value] ? { background: "var(--pt-accent)", color: "var(--pt-on-accent)", borderColor: "transparent" } : { background: "#f7f4f0", color: "#6B6058", borderColor: "rgba(3,35,68,.10)" }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <button type="button" disabled={!absentValid || busy} onClick={saveAbsent} className="self-start rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-45" style={{ background: "var(--pt-accent)", color: "var(--pt-on-accent)" }}>
                {busy ? "Submitting…" : "Submit absence & make-up plan"}
              </button>
            </div>
          )}
        </div>
      )}

      {orderedKeys.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-bold text-ink/70">Recorded this term</h2>
          {orderedKeys.map((k) => {
            const r = records[k];
            const d = fromKey(k);
            const pretty = `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}`;
            if (r.type === "late") {
              return (
                <div key={k} className="rounded-xl border border-ink/10 bg-white p-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-medium">{pretty}</div>
                    {r.arrive && <div className="text-xs text-ink/50">Arriving at {r.arrive}</div>}
                  </div>
                  <span className="text-[11px] font-semibold rounded-full px-2 py-0.5" style={{ background: COLOR.late.soft, color: COLOR.late.dot }}>Late</span>
                </div>
              );
            }
            return (
              <div key={k} className="rounded-xl border border-ink/10 bg-white p-4 flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-medium">{pretty}</div>
                  {r.reason && <div className="text-xs text-ink/50">{r.reason}</div>}
                  {r.slots.length > 0 && <div className="text-xs mt-1.5" style={{ color: "var(--pt-accent-fg)" }}>Make-up check-in · {r.slots.length} time{r.slots.length === 1 ? "" : "s"} offered</div>}
                </div>
                <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 shrink-0" style={{ background: COLOR.absent.soft, color: COLOR.absent.dot }}>Absent</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
