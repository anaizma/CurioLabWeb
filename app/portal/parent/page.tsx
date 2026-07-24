import Link from "next/link";
import { getGuardianView } from "@/lib/portal/guardian/guardian-data";
import { getAttendanceView } from "@/lib/portal/guardian/attendance-data";
import { getGuardianCalendarView } from "@/lib/portal/guardian/calendar-data";
import NominationCard from "@/components/portal/guardian/NominationCard";
import type { ActivityVisibility } from "@/lib/portal/guardian/types";

const VIS_STYLE: Record<ActivityVisibility, { bg: string; fg: string }> = {
  chapter: { bg: "#eef0f2", fg: "#44515f" },
  community: { bg: "var(--pt-accent-soft)", fg: "var(--pt-accent-fg)" },
  newsletter: { bg: "#e7f2ea", fg: "#2f7a4d" },
};

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default async function GuardianHomePage() {
  const [v, att, cal] = await Promise.all([getGuardianView(), getAttendanceView(), getGuardianCalendarView()]);
  const active = v.grants.filter((g) => g.status === "granted" || g.status === "expiring").length;
  const needsForm = v.grants.filter((g) => g.status === "needs_form").length;
  const expiring = v.grants.filter((g) => g.status === "expiring");
  const absCount = att.live ? att.counts.totalAbsences : att.sampleRecords.filter((r) => r.type === "absent").length;
  const lateCount = att.live ? att.counts.late : att.sampleRecords.filter((r) => r.type === "late").length;
  const now = Date.now();
  const upcoming = cal.events
    .filter((e) => new Date(e.startsAt).getTime() >= now)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
    .slice(0, 4);

  return (
    <div className="mx-auto max-w-[1500px] px-5 py-5">
      {v.isSample && (
        <div className="text-[11px] font-mono text-muted border border-dashed border-black/15 rounded-md px-3 py-2 mb-4">
          Sample data — sign in as a guardian to see your family&apos;s records.
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-[290px_minmax(0,1fr)_330px] gap-5 items-start">
        <aside className="flex flex-col gap-4 lg:sticky lg:top-4">
          <div className="bg-white border border-black/[.08] rounded-lg overflow-hidden">
            <div className="h-14" style={{ background: "var(--pt-banner)" }} />
            <div className="px-4 pb-4 -mt-6">
              <div className="w-12 h-12 rounded-md border-2 border-white grid place-items-center text-white text-lg font-bold" style={{ background: "var(--pt-accent)" }}>
                {v.child.displayName.charAt(0)}
              </div>
              <h1 className="text-lg font-bold tracking-tight mt-2.5">{v.child.displayName}</h1>
              <div className="font-mono text-[11px] text-muted mt-0.5 leading-relaxed">{v.child.ageBand} · {v.child.chapterName}</div>
              <div className="mt-4 flex flex-col gap-2">
                <div className="flex items-center justify-between text-[12.5px]"><span className="text-muted">Consents active</span><span className="font-mono font-semibold">{active}/{v.grants.length}</span></div>
                <div className="flex items-center justify-between text-[12.5px]"><span className="text-muted">Absences this term</span><span className="font-mono font-semibold">{absCount}</span></div>
                <div className="flex items-center justify-between text-[12.5px]"><span className="text-muted">Late arrivals</span><span className="font-mono font-semibold">{lateCount}</span></div>
              </div>
              {needsForm > 0 && (
                <div className="mt-4 border rounded-md px-3 py-2 text-[12px]" style={{ background: "var(--pt-accent-soft)", borderColor: "var(--pt-accent-border)", color: "var(--pt-accent-fg)" }}>
                  {needsForm} consent{needsForm === 1 ? "" : "s"} need{needsForm === 1 ? "s" : ""} a signed form
                </div>
              )}
              <Link href="/portal/parent/messages" className="mt-3 block w-full text-center text-[12.5px] font-semibold px-3 py-2 rounded-md" style={{ background: "var(--pt-accent)", color: "var(--pt-on-accent)" }}>
                Message the team
              </Link>
            </div>
          </div>
        </aside>

        <main className="flex flex-col gap-4 min-w-0">
          <div className="bg-white border border-black/[.08] rounded-lg p-4 flex flex-col gap-3">
            <div className="label text-[10.5px]">Needs your attention</div>
            {v.nominations.map((n) => (
              <NominationCard key={n.id} nomination={n} childName={v.child.displayName} />
            ))}
            {expiring.map((g) => (
              <div key={g.grantType} className="border border-black/[.08] rounded-md px-3 py-2.5 flex items-center justify-between gap-3 text-[13px]">
                <span><b>{g.label}</b> — {g.expiresLabel.toLowerCase()}.</span>
                <Link href="/portal/parent/consent" className="text-[12px] font-semibold shrink-0" style={{ color: "var(--pt-accent)" }}>Renew</Link>
              </div>
            ))}
            {v.nominations.length === 0 && expiring.length === 0 && <p className="text-[13px] text-muted">Nothing needs your attention right now.</p>}
          </div>

          <div className="bg-white border border-black/[.08] rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="label text-[10.5px]">Recent activity</div>
              <Link href="/portal/parent/activity" className="text-[11px] font-semibold" style={{ color: "var(--pt-accent)" }}>All activity →</Link>
            </div>
            <div className="flex flex-col divide-y divide-black/[.05]">
              {v.activity.map((it) => {
                const s = VIS_STYLE[it.visibility];
                return (
                  <div key={it.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium truncate">{it.title}</div>
                      <div className="font-mono text-[10.5px] text-muted">{it.kind} · {it.dateLabel}</div>
                    </div>
                    <span className="font-mono text-[9.5px] uppercase tracking-wider rounded-full px-2 py-0.5 shrink-0" style={{ background: s.bg, color: s.fg }}>{it.visibilityLabel}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </main>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-4">
          <div className="bg-white border border-black/[.08] rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="label text-[10.5px]">Upcoming</div>
              <Link href="/portal/parent/calendar" className="text-[11px] font-semibold" style={{ color: "var(--pt-accent)" }}>Calendar →</Link>
            </div>
            <div className="flex flex-col divide-y divide-black/[.05]">
              {upcoming.length === 0 ? (
                <p className="text-[13px] text-muted py-1">No upcoming events.</p>
              ) : (
                upcoming.map((e) => (
                  <div key={e.id} className="py-2.5">
                    <div className="text-[13px] font-medium">{e.title}</div>
                    <div className="font-mono text-[10.5px] text-muted mt-0.5">{fmtWhen(e.startsAt)}{e.location ? ` · ${e.location}` : ""}</div>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="bg-white border border-black/[.08] rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="label text-[10.5px]">Attendance</div>
              <Link href="/portal/parent/attendance" className="text-[11px] font-semibold" style={{ color: "var(--pt-accent)" }}>Report →</Link>
            </div>
            <p className="text-[12.5px] text-muted">Saturday sessions. Report an absence or late arrival, and schedule the 30-minute make-up check-in.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
