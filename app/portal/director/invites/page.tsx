import { getInvitesView } from "@/lib/portal/director/invites-data";
import SampleBanner from "@/components/portal/SampleBanner";
import InvitesClient from "./invites-client";
import { requireDirector } from "@/lib/portal/director/guard";

export default async function DirectorInvitesPage() {
  // Gate first: nothing below this line runs for a non-director (see guard.ts).
  await requireDirector();
  const view = await getInvitesView();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Invites</h1>
        <p className="text-ink/60 text-sm mt-1">
          Invite guardians, mentors, and staff to create their CurioLab accounts. Students are invited by their guardian, not here.
        </p>
      </div>
      {view.isSample && <SampleBanner />}
      <InvitesClient chapterId={view.chapterId} invites={view.invites} isSample={view.isSample} />
    </div>
  );
}
