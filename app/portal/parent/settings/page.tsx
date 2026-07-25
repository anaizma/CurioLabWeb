import { getMyInformation } from "@/lib/portal/settings/my-info-data";
import SettingsShell from "@/components/portal/settings/SettingsShell";
import MyInformation from "@/components/portal/settings/MyInformation";

export default async function ParentSettingsPage() {
  const view = await getMyInformation("parent");
  return (
    <SettingsShell active="my-information">
      <MyInformation view={view} />
    </SettingsShell>
  );
}
