import { getGuardianCalendarView } from "@/lib/portal/guardian/calendar-data";
import { getAttendanceView } from "@/lib/portal/guardian/attendance-data";
import GuardianCalendarClient from "./calendar-client";

function keyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function GuardianCalendarPage() {
  const [cal, att] = await Promise.all([getGuardianCalendarView(), getAttendanceView()]);
  const eventKeyById = new Map(
    att.sessions.map((s) => {
      const d = new Date(s.startsAt);
      return [s.eventId, isNaN(d.getTime()) ? "" : keyOf(d)] as const;
    }),
  );
  const absentKeys = att.live
    ? att.existing.filter((x) => x.type === "absent").map((x) => eventKeyById.get(x.sessionEventId) ?? "").filter(Boolean)
    : att.sampleRecords.filter((r) => r.type === "absent").map((r) => r.dateKey);
  return (
    <div className="mx-auto max-w-[1400px] px-5 py-5 flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Chapter calendar</h1>
        <p className="text-muted text-[13px] mt-1">Sessions and events your chapter has shared with families. Open an event to RSVP.</p>
      </div>
      {cal.isSample && (
        <div className="text-[11px] font-mono text-muted border border-dashed border-black/15 rounded-md px-3 py-2">Sample data — sign in as a guardian to see your chapter&apos;s live calendar.</div>
      )}
      <GuardianCalendarClient events={cal.events} absentKeys={absentKeys} />
    </div>
  );
}
