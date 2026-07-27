import SettingsShell from "@/components/portal/settings/SettingsShell";
import ActiveSessions from "@/components/portal/settings/ActiveSessions";

export default function ParentSecuritySettingsPage() {
  return (
    <SettingsShell active="security" basePath="/portal/parent/settings">
      <ActiveSessions />
    </SettingsShell>
  );
}
