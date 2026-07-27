import { getMyInformation } from "@/lib/portal/settings/my-info-data";
import SettingsShell from "@/components/portal/settings/SettingsShell";
import MyInformation from "@/components/portal/settings/MyInformation";
import { requireDirector } from "@/lib/portal/director/guard";

export default async function DirectorSettingsPage() {
  // Gate first: nothing below this line runs for a non-director (see guard.ts).
  await requireDirector();
  const view = await getMyInformation("director");
  return (
    <SettingsShell active="my-information" basePath="/portal/director/settings">
      <MyInformation view={view} />
    </SettingsShell>
  );
}
