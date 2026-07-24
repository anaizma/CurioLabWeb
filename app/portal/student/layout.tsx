import PortalShell, { type PortalNavItem } from "@/components/portal/PortalShell";

const STUDENT_NAV: PortalNavItem[] = [
  { label: "The Lab", href: "/portal/student/lab" },
  { label: "Projects", href: "/portal/student/projects" },
  { label: "Profile", href: "/portal/student" },
  { label: "Community", href: "/portal/student/community" },
];

export default function StudentPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalShell
      role="student"
      roleLabel="Student Portal"
      nav={STUDENT_NAV}
      activeHref="/portal/student"
      avatarInitial="M"
    >
      {children}
    </PortalShell>
  );
}
