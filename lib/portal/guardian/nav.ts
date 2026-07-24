import type { PortalNavItem } from "@/components/portal/PortalShell";

export const GUARDIAN_NAV: PortalNavItem[] = [
  { label: "Home", href: "/portal/parent" },
  { label: "Consent", href: "/portal/parent/consent" },
  { label: "Activity", href: "/portal/parent/activity" },
  { label: "Attendance", href: "/portal/parent/attendance" },
  { label: "Calendar", href: "/portal/parent/calendar" },
  { label: "Messages", href: "/portal/parent/messages" },
];

/** The nav href to highlight for a pathname: longest item href the path equals or
 *  sits under; Home ("/portal/parent") only matches exactly. Falls back to Home. */
export function guardianActiveFrom(pathname: string): string {
  const match = GUARDIAN_NAV.filter((i) => pathname === i.href || pathname.startsWith(i.href + "/")).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
  return match?.href ?? "/portal/parent";
}
