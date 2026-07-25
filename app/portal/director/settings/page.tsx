import { getMyInformation } from "@/lib/portal/settings/my-info-data";
import SettingsShell from "@/components/portal/settings/SettingsShell";
import MyInformation from "@/components/portal/settings/MyInformation";

export default async function DirectorSettingsPage() {
  const view = await getMyInformation("director");
  return (
    <SettingsShell active="my-information">
      <MyInformation view={view} />
    </SettingsShell>
  );
}
