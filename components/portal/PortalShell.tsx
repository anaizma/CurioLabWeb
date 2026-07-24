import Link from "next/link";

export interface PortalNavItem {
  label: string;
  href: string;
}

/**
 * Shared portal chrome: an ink top bar with the CurioLab wordmark + role label,
 * role nav tabs (active tab uses the role accent), and an avatar slot. Wraps its
 * children in a data-portal themed region so every child reads --pt-* tokens.
 */
export default function PortalShell({
  role,
  roleLabel,
  nav,
  activeHref,
  avatarInitial,
  children,
}: {
  role: string;
  roleLabel: string;
  nav: PortalNavItem[];
  activeHref: string;
  avatarInitial: string;
  children: React.ReactNode;
}) {
  return (
    <div data-portal={role} className="min-h-screen bg-cream text-ink">
      <header className="bg-ink text-white">
        <div className="mx-auto max-w-5xl px-6 h-14 flex items-center justify-between gap-6">
          <div className="flex items-center gap-2.5 font-bold">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--pt-accent)" }} />
            CurioLab
            <span className="font-normal text-white/55 text-sm ml-1">{roleLabel}</span>
          </div>
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
          <div className="w-8 h-8 rounded-full grid place-items-center text-xs font-bold text-white"
               style={{ background: "var(--pt-accent)" }}>
            {avatarInitial}
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
