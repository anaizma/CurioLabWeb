import Link from "next/link";
import PortalSidebar from "./PortalSidebar";

export interface PortalNavItem {
  label: string;
  href: string;
}

export interface PortalNavGroup {
  title: string;
  items: PortalNavItem[];
}

/**
 * Shared portal chrome. Ink top bar (brand + role label + avatar) always.
 * Pass `nav` for the student-style top-bar tabs, OR `sidebar` for an ops-style
 * grouped left rail (director). When `sidebar` is set the top-bar tabs are
 * suppressed and children render in a two-column [rail | content] region.
 * Children read --pt-* accent tokens via the data-portal wrapper either way.
 */
export default function PortalShell({
  role,
  roleLabel,
  nav,
  sidebar,
  activeHref,
  avatarInitial,
  children,
}: {
  role: string;
  roleLabel: string;
  nav?: PortalNavItem[];
  sidebar?: PortalNavGroup[];
  activeHref: string;
  avatarInitial: string;
  children: React.ReactNode;
}) {
  return (
    <div data-portal={role} className="min-h-screen bg-cream text-ink">
      <header className="bg-ink text-white">
        <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between gap-6">
          <div className="flex items-center gap-2 font-bold">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/curiolab-mark.png" alt="CurioLab" width={24} height={24} className="w-6 h-6 object-contain" />
            CurioLab
            <span className="font-normal text-white/55 text-sm ml-1">{roleLabel}</span>
          </div>
          {!sidebar && nav && (
            <nav className="hidden sm:flex items-center gap-6 text-sm">
              {nav.map((item) => {
                const on = item.href === activeHref;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={on ? "font-semibold text-white" : "text-white/60 hover:text-white transition-colors"}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          )}
          <div
            className="w-8 h-8 rounded-full grid place-items-center text-xs font-bold text-white"
            style={{ background: "var(--pt-accent)" }}
          >
            {avatarInitial}
          </div>
        </div>
      </header>

      {sidebar && (
        <div className="md:hidden border-b border-ink/10 bg-cream">
          <nav className="flex gap-4 overflow-x-auto px-6 py-2 text-sm whitespace-nowrap">
            {sidebar.flatMap((g) => g.items).map((item) => {
              const on = item.href === activeHref;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={on ? "font-semibold shrink-0" : "text-ink/60 shrink-0"}
                  style={on ? { color: "var(--pt-accent)" } : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}

      {sidebar ? (
        <PortalSidebar sidebar={sidebar} activeHref={activeHref}>
          {children}
        </PortalSidebar>
      ) : (
        children
      )}
    </div>
  );
}
