"use client";

import { useState } from "react";
import Link from "next/link";
import type { PortalNavGroup } from "./PortalShell";

/**
 * Collapsible left rail for the ops (director) shell. A hamburger toggles the
 * grouped nav open/closed on md+; the content reflows to fill the freed space.
 * Mobile keeps the shell's horizontal scroll nav, so this rail is md-only.
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
  const [open, setOpen] = useState(true);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className={`flex items-start ${open ? "md:gap-8" : "md:gap-4"}`}>
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

        <main className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Collapse menu" : "Expand menu"}
            aria-expanded={open}
            className="hidden md:inline-flex items-center justify-center w-9 h-9 rounded-lg border border-ink/10 bg-white text-ink/70 hover:bg-cream transition-colors mb-4"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          {children}
        </main>
      </div>
    </div>
  );
}
