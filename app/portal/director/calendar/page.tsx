import { getCalendarView } from "@/lib/portal/director/calendar-data";
import SampleBanner from "@/components/portal/SampleBanner";
import CalendarClient from "./calendar-client";

export default async function DirectorCalendarPage() {
  const view = await getCalendarView();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Calendar</h1>
        <p className="text-ink/60 text-sm mt-1">
          Publish sessions and events, and tag who sees each one — parents, mentors, or fellow directors. Sessions here drive attendance.
        </p>
      </div>
      {view.isSample && <SampleBanner />}
      <CalendarClient chapterId={view.chapterId} events={view.events} />
    </div>
  );
}
