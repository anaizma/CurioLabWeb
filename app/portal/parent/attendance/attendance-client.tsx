"use client";

import { useState } from "react";

type AbsentRec = { type: "absent"; reason: string; slots: string[] };
type LateRec = { type: "late"; arrive: string };
type Rec = AbsentRec | LateRec;

const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SESSION_DOW = 6; // Saturday, 10:00 AM

const COLOR = {
  session: { dot: "#2F7A4D", soft: "#E7F2EA" },
  absent: { dot: "#B23B2A", soft: "#FBE3DF" },
  late: { dot: "#B8860B", soft: "#FCF1D6" },
};

function keyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function isSession(d: Date): boolean {
  return d.getDay() === SESSION_DOW;
}
function nextSession(d: Date): Date {
  const c = new Date(d);
  do {
    c.setDate(c.getDate() + 1);
  } while (!isSession(c));
  return c;
}
function fromKey(k: string): Date {
  return new Date(k + "T12:00:00");
}
function slotOptions(sel: Date): string[] {
  const ns = nextSession(sel);
  const out: string[] = [];
  const c = new Date(sel);
  c.setDate(c.getDate() + 1);
  while (keyOf(c) !== keyOf(ns) && out.length < 4) {
    const lbl = `${DOW[c.getDay()]} ${MON[c.getMonth()].slice(0, 3)} ${c.getDate()}`;
    out.push(`${lbl} · 4:00 PM`);
    out.push(`${lbl} · 7:00 PM`);
    c.setDate(c.getDate() + 1);
  }
  out.push(`${DOW[ns.getDay()]} ${MON[ns.getMonth()].slice(0, 3)} ${ns.getDate()} · 9:30 AM (before session)`);
  return out.slice(0, 5);
}

export default function AttendanceClient({ childName }: { childName: string }) {
  const now = new Date();
  const calY = now.getFullYear();
  const calM = now.getMonth();
  const todayKey = keyOf(now);

  const [records, setRecords] = useState<Record<string, Rec>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"absent" | "late" | null>(null);
  const [reason, setReason] = useState("");
  const [consent, setConsent] = useState(false);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [arrive, setArrive] = useState("10:30");

  const absCount = Object.values(records).filter((r) => r.type === "absent").length;
  const lateCount = Object.values(records).filter((r) => r.type === "late").length;

  function openDay(k: string) {
    setSelected(k);
    const r = records[k];
    if (r) {
      setMode(r.type);
      if (r.type === "late") setArrive(r.arrive);
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
  function saveLate() {
    if (!selected) return;
    setRecords((m) => ({ ...m, [selected]: { type: "late", arrive } }));
    close();
  }
  function saveAbsent() {
    if (!selected) return;
    const slots = Object.keys(chosen).filter((s) => chosen[s]);
    setRecords((m) => ({ ...m, [selected]: { type: "absent", reason: reason.trim(), slots } }));
    close();
  }

  const first = new Date(calY, calM, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(calY, calM + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(calY, calM, d));

  const sel = selected ? fromKey(selected) : null;
  const ns = sel ? nextSession(sel) : null;
  const nsLabel = ns ? `${DOW[ns.getDay()]}, ${MON[ns.getMonth()]} ${ns.getDate()} at 10:00 AM` : "";
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
            <div className="text-sm font-semibold">{DOW[sel.getDay()]}, {MON[sel.getMonth()]} {sel.getDate()} · session at 10:00 AM</div>
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
              <button type="button" onClick={saveLate} className="self-start rounded-lg px-4 py-2 text-sm font-semibold" style={{ background: "var(--pt-accent)", color: "var(--pt-on-accent)" }}>
                Save late notice
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
                      key={s}
                      type="button"
                      onClick={() => setChosen((c) => ({ ...c, [s]: !c[s] }))}
                      className="rounded-full px-3 py-1.5 text-xs font-medium border"
                      style={chosen[s] ? { background: "var(--pt-accent)", color: "var(--pt-on-accent)", borderColor: "transparent" } : { background: "#f7f4f0", color: "#6B6058", borderColor: "rgba(3,35,68,.10)" }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <button type="button" disabled={!absentValid} onClick={saveAbsent} className="self-start rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-45" style={{ background: "var(--pt-accent)", color: "var(--pt-on-accent)" }}>
                Submit absence &amp; make-up plan
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
                    <div className="text-xs text-ink/50">Arriving at {r.arrive}</div>
                  </div>
                  <span className="text-[11px] font-semibold rounded-full px-2 py-0.5" style={{ background: COLOR.late.soft, color: COLOR.late.dot }}>Late</span>
                </div>
              );
            }
            return (
              <div key={k} className="rounded-xl border border-ink/10 bg-white p-4 flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-medium">{pretty}</div>
                  <div className="text-xs text-ink/50">{r.reason}</div>
                  <div className="text-xs mt-1.5" style={{ color: "var(--pt-accent-fg)" }}>Make-up check-in · {r.slots.join(" or ")}</div>
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
