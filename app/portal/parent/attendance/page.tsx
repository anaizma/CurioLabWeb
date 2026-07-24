import { getGuardianView } from "@/lib/portal/guardian/guardian-data";
import SampleBanner from "@/components/portal/SampleBanner";
import AttendanceClient from "./attendance-client";

export default async function GuardianAttendancePage() {
  const v = await getGuardianView();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Attendance</h1>
        <p className="text-ink/60 text-sm mt-1">
          Saturday sessions are marked on the calendar. Tap a session to tell us {v.child.displayName} will be absent or late. An absence can be made up with a 30-minute virtual check-in.
        </p>
      </div>
      {v.isSample && <SampleBanner />}
      <AttendanceClient childName={v.child.displayName} />
    </div>
  );
}
