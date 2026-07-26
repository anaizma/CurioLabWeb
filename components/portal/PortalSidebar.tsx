"use client";

import { createContext, useContext, useState } from "react";
import Link from "next/link";
import type { PortalNavGroup } from "./PortalShell";

interface SidebarState {
  open: boolean;
  toggle: () => void;
}
const SidebarContext = createContext<SidebarState | null>(null);

/** Holds the collapse state so the header toggle and the left rail stay in sync. */
export function PortalSidebarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return <SidebarContext.Provider value={{ open, toggle: () => setOpen((v) => !v) }}>{children}</SidebarContext.Provider>;
}

/**
 * Sidebar collapse toggle, rendered in the header's top-left corner. A chevron
 * pointing left ("<") when open (collapse), flipping to ">" when collapsed
 * (expand). Renders nothing outside a provider, so it self-hides in nav mode.
 */
export function SidebarToggle() {
  const ctx = useContext(SidebarContext);
  if (!ctx) return null;
  const { open, toggle } = ctx;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={open ? "Collapse menu" : "Expand menu"}
      aria-expanded={open}
      className="hidden md:inline-flex items-center justify-center w-7 h-7 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className={`transition-transform duration-200 ${open ? "" : "rotate-180"}`}>
        <path d="M10 3.5 L5.5 8 L10 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/**
 * Collapsible left rail for the ops (director) shell. Reads the shared collapse
 * state; the content reflows to fill the freed space when collapsed. Mobile
 * keeps the shell's horizontal scroll nav, so this rail is md-only.
 */
export default function PortalSidebar({
  sidebar,
  activeHref,
  children,
}: {
  sidebar: PortalNavGroup[];
  activeHref: string;
  children: React.ReactNode;
}) {
  const open = useContext(SidebarContext)?.open ?? true;

  return (
    // Full-bleed (no centered max-width cap): the rail sticks to the left edge at
    // every screen size and the main region flexes to fill all remaining width,
    // so there is no dead space on the right.
    <div className="w-full px-6 py-8">
      <div className={`flex items-start ${open ? "md:gap-8" : "md:gap-0"}`}>
        <aside className={`hidden md:block shrink-0 overflow-hidden transition-[width] duration-200 ${open ? "w-52" : "w-0"}`}>
          <nav className="flex flex-col gap-6 text-sm w-52">
            {sidebar.map((group) => (
              <div key={group.title} className="flex flex-col gap-1.5">
                <div className="label text-[11px] uppercase tracking-wide text-ink/40">{group.title}</div>
                {group.items.map((item) => {
                  const on = item.href === activeHref;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={on ? "font-semibold" : "text-ink/60 hover:text-ink transition-colors"}
                      style={on ? { color: "var(--pt-accent)" } : undefined}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
