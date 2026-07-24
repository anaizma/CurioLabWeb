import type { PortalNavGroup } from "@/components/portal/PortalShell";

export const DIRECTOR_NAV: PortalNavGroup[] = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard", href: "/portal/director" },
      { label: "Calendar", href: "/portal/director/calendar" },
    ],
  },
  {
    title: "Intake",
    items: [
      { label: "Applications", href: "/portal/director/applications" },
      { label: "Invites", href: "/portal/director/invites" },
      { label: "Enrollments", href: "/portal/director/enrollments" },
    ],
  },
  {
    title: "People",
    items: [
      { label: "Members", href: "/portal/director/members" },
      { label: "Guardianships", href: "/portal/director/guardianships" },
      { label: "Pods & terms", href: "/portal/director/pods" },
    ],
  },
  {
    title: "Safety",
    items: [
      { label: "Moderation", href: "/portal/director/moderation" },
      { label: "Media", href: "/portal/director/media" },
      { label: "Requests", href: "/portal/director/requests" },
    ],
  },
  { title: "Content", items: [{ label: "Newsletter & reviews", href: "/portal/director/content" }] },
  { title: "Oversight", items: [{ label: "Audit log", href: "/portal/director/audit" }] },
];

/** The nav href to highlight for a given pathname: the longest item href that the
 *  path equals or sits under (so /applications/{id} highlights Applications).
 *  Dashboard ("/portal/director") only matches exactly. Falls back to Dashboard. */
export function activeFrom(pathname: string): string {
  const items = DIRECTOR_NAV.flatMap((g) => g.items);
  const match = items
    .filter((i) => pathname === i.href || pathname.startsWith(i.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match?.href ?? "/portal/director";
}
