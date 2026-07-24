"use client";

import { usePathname } from "next/navigation";
import PortalShell from "@/components/portal/PortalShell";
import { GUARDIAN_NAV, guardianActiveFrom } from "@/lib/portal/guardian/nav";

export default function GuardianPortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/portal/parent";
  return (
    <PortalShell
      role="parent"
      roleLabel="Guardian"
      nav={GUARDIAN_NAV}
      activeHref={guardianActiveFrom(pathname)}
      avatarInitial="G"
    >
      <div className="mx-auto max-w-3xl px-6 py-8">{children}</div>
    </PortalShell>
  );
}
