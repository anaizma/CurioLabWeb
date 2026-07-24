import { getGuardianView } from "@/lib/portal/guardian/guardian-data";
import { getAttendanceView } from "@/lib/portal/guardian/attendance-data";
import AttendanceClient from "./attendance-client";

export default async function GuardianAttendancePage() {
  const [v, att] = await Promise.all([getGuardianView(), getAttendanceView()]);
  return (
    <div className="mx-auto max-w-3xl px-5 py-5 flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Attendance</h1>
        <p className="text-muted text-[13px] mt-1">Tap a session day to report {v.child.displayName} absent or late. An absence is made up with a 30-minute virtual check-in before the next session.</p>
      </div>
      {att.isSample && (
        <div className="text-[11px] font-mono text-muted border border-dashed border-black/15 rounded-md px-3 py-2">Sample data — sign in as a guardian to file real reports.</div>
      )}
      <AttendanceClient childName={v.child.displayName} childId={att.childId} sessions={att.sessions} existing={att.existing} counts={att.counts} sampleRecords={att.sampleRecords} live={att.live} />
    </div>
  );
}
