import { getDirectorMailView } from "@/lib/portal/director/mail-data";
import DirectorMessagesClient from "@/components/portal/director/DirectorMessagesClient";
import SampleBanner from "@/components/portal/SampleBanner";
import { requireDirector } from "@/lib/portal/director/guard";

export default async function DirectorMessagesPage() {
  // Gate first: nothing below this line runs for a non-director (see guard.ts).
  await requireDirector();
  const view = await getDirectorMailView();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Messages</h1>
        <p className="text-ink/60 text-sm mt-1">
          Your conversations with parents and members, plus a read-only view of mentor, student and family threads across the chapter.
        </p>
      </div>
      {view.isSample && <SampleBanner />}
      <DirectorMessagesClient view={view} />
    </div>
  );
}
