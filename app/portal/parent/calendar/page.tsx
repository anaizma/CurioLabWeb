import { getGuardianCalendarView } from "@/lib/portal/guardian/calendar-data";
import GuardianCalendarClient from "./calendar-client";

export default async function GuardianCalendarPage() {
  const cal = await getGuardianCalendarView();
  return (
    <div className="mx-auto max-w-5xl px-5 py-5 flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Chapter calendar</h1>
        <p className="text-muted text-[13px] mt-1">Sessions and events your chapter has shared with families. Open an event to RSVP.</p>
      </div>
      {cal.isSample && (
        <div className="text-[11px] font-mono text-muted border border-dashed border-black/15 rounded-md px-3 py-2">Sample data — sign in as a guardian to see your chapter&apos;s live calendar.</div>
      )}
      <GuardianCalendarClient events={cal.events} />
    </div>
  );
}
