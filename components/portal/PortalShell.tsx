import Link from "next/link";
import PortalSidebar, { PortalSidebarProvider, SidebarToggle } from "./PortalSidebar";

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
  const body = (
    <>
      <header className="bg-ink text-white">
        {/* Sidebar (ops) shell goes full-width so the brand pins to the far-left
            above the rail and the avatar to the far-right; nav mode (student/
            parent) keeps the centered max-width. */}
        <div className={`${sidebar ? "w-full" : "mx-auto max-w-6xl"} px-6 h-14 flex items-center justify-between gap-6`}>
          <div className="flex items-center gap-2 font-bold">
            {/* Sidebar collapse toggle, pinned to the top-left corner (self-hides in nav mode). */}
            <SidebarToggle />
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
          <div className="flex items-center gap-3 shrink-0">
            <Link
              href={`/portal/${role}/settings`}
              aria-label="Settings"
              title="Settings"
              className="w-8 h-8 rounded-full grid place-items-center text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </Link>
            <div
              className="w-8 h-8 rounded-full grid place-items-center text-xs font-bold text-white"
              style={{ background: "var(--pt-accent)" }}
            >
              {avatarInitial}
            </div>
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
    </>
  );

  return (
    <div data-portal={role} className="min-h-screen bg-cream text-ink">
      {sidebar ? <PortalSidebarProvider>{body}</PortalSidebarProvider> : body}
    </div>
  );
}
