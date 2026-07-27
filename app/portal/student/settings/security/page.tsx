import SettingsShell from "@/components/portal/settings/SettingsShell";
import ActiveSessions from "@/components/portal/settings/ActiveSessions";

export default function StudentSecuritySettingsPage() {
  return (
    <SettingsShell active="security" basePath="/portal/student/settings">
      <ActiveSessions />
    </SettingsShell>
  );
}
