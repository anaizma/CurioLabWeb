import SettingsShell from "@/components/portal/settings/SettingsShell";
import ActiveSessions from "@/components/portal/settings/ActiveSessions";
import { requireDirector } from "@/lib/portal/director/guard";

export default async function DirectorSecuritySettingsPage() {
  // Gate first: nothing below this line runs for a non-director (see guard.ts).
  await requireDirector();
  return (
    <SettingsShell active="security" basePath="/portal/director/settings">
      <ActiveSessions />
    </SettingsShell>
  );
}
