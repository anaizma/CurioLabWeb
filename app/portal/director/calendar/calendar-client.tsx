"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CalendarEvent, CalendarAudience, CalendarKind } from "@/lib/portal/director/calendar-data";

const AUD: { key: CalendarAudience; label: string }[] = [
  { key: "parent", label: "Parents" },
  { key: "mentor", label: "Mentors" },
  { key: "director", label: "Directors" },
];
const KINDS: CalendarKind[] = ["session", "orientation", "meeting", "other"];
const inputCls = "w-full rounded-lg border border-ink/15 px-3 py-2 text-sm bg-white";

function fmt(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export default function CalendarClient({ chapterId, events }: { chapterId: string | null; events: CalendarEvent[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<CalendarKind>("session");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [aud, setAud] = useState<Record<CalendarAudience, boolean>>({ parent: true, mentor: true, director: false });
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canWrite = chapterId !== null;
  const audiences = AUD.map((a) => a.key).filter((k) => aud[k]);
  const valid = canWrite && title.trim().length > 0 && startsAt.length > 0 && endsAt.length > 0 && audiences.length > 0;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || !chapterId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ops/calendar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chapterId,
          title: title.trim(),
          kind,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          audiences,
          location: location.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        setError(res.status === 400 ? "Check the fields — end must be after start, and pick at least one audience." : res.status === 403 ? "You don't have permission." : "Could not create the event.");
        return;
      }
      setTitle("");
      setStartsAt("");
      setEndsAt("");
      setLocation("");
      setNotes("");
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelEvent(id: string) {
    if (!chapterId) return;
    if (typeof window !== "undefined" && !window.confirm("Cancel this event? It will drop off everyone's calendar.")) return;
    try {
      const res = await fetch(`/api/ops/calendar/${id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="grid lg:grid-cols-2 gap-8">
      <form onSubmit={create} className="rounded-2xl border border-ink/10 bg-white p-6 flex flex-col gap-3">
        <h2 className="font-bold">New event</h2>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/60">Title</span>
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekly build session" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/60">Type</span>
          <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as CalendarKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink/60">Starts</span>
            <input type="datetime-local" className={inputCls} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink/60">Ends</span>
            <input type="datetime-local" className={inputCls} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </label>
        </div>
        <div className="flex flex-col gap-1.5 text-sm">
          <span className="text-ink/60">Who can see it</span>
          <div className="flex gap-2 flex-wrap">
            {AUD.map((a) => {
              const on = aud[a.key];
              return (
                <button key={a.key} type="button" onClick={() => setAud((s) => ({ ...s, [a.key]: !s[a.key] }))}
                  className="rounded-full px-3 py-1.5 text-xs font-medium border"
                  style={on ? { background: "var(--pt-accent)", color: "var(--pt-on-accent)", borderColor: "transparent" } : { background: "#f7f4f0", color: "#6B6058", borderColor: "rgba(3,35,68,.12)" }}>
                  {a.label}
                </button>
              );
            })}
          </div>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/60">Location (optional)</span>
          <input className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/60">Notes (optional)</span>
          <textarea className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <button type="submit" disabled={!valid || busy} className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50" style={{ background: "var(--pt-accent)", color: "var(--pt-on-accent)" }}>
          {busy ? "Publishing…" : "Publish event"}
        </button>
        {!canWrite && <p className="text-xs text-ink/50">Sign in as a Chapter Director to publish events.</p>}
        {error && <p className="text-xs" style={{ color: "var(--pt-accent-fg)" }}>{error}</p>}
      </form>

      <div className="rounded-2xl border border-ink/10 bg-white p-6">
        <h2 className="font-bold mb-3">Scheduled</h2>
        <ul className="flex flex-col divide-y divide-ink/5">
          {events.length === 0 ? (
            <li className="text-sm text-ink/50 py-3">No events yet.</li>
          ) : (
            events.map((ev) => (
              <li key={ev.id} className="py-3 flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">
                    {ev.title} <span className="text-ink/40 font-normal text-xs">· {ev.kind}</span>
                  </div>
                  <div className="text-xs text-ink/50">
                    {fmt(ev.startsAt)}
                    {ev.location ? ` · ${ev.location}` : ""}
                  </div>
                  <div className="flex gap-1.5 mt-1 flex-wrap">
                    {ev.audiences.map((a) => (
                      <span key={a} className="text-[10px] font-semibold rounded-full px-2 py-0.5" style={{ background: "var(--pt-accent-soft)", color: "var(--pt-accent-fg)" }}>{a}</span>
                    ))}
                  </div>
                </div>
                {chapterId && (
                  <button type="button" onClick={() => cancelEvent(ev.id)} className="text-xs font-semibold shrink-0 text-ink/50 hover:text-ink">Cancel</button>
                )}
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
