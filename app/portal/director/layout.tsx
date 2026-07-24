"use client";

import { usePathname } from "next/navigation";
import PortalShell from "@/components/portal/PortalShell";
import { DIRECTOR_NAV, activeFrom } from "@/lib/portal/director/nav";

export default function DirectorPortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/portal/director";
  return (
    <PortalShell
      role="director"
      roleLabel="Chapter Director"
      sidebar={DIRECTOR_NAV}
      activeHref={activeFrom(pathname)}
      avatarInitial="D"
    >
      {children}
    </PortalShell>
  );
}
