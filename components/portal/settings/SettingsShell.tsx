import Link from "next/link";
import type { ReactNode } from "react";

// Settings has room for several sections. "My information" and "Account &
// security" are built; the rest are not links yet and say so rather than
// pretending to be clickable.
const NAV = [
  { key: "my-information", label: "My information", path: "", ready: true },
  { key: "security", label: "Account & security", path: "/security", ready: true },
  { key: "notifications", label: "Notifications", path: "/notifications", ready: false },
  { key: "privacy", label: "Privacy", path: "/privacy", ready: false },
];

export default function SettingsShell({
  active = "my-information",
  /**
   * The portal's settings root, e.g. "/portal/director/settings". Each portal
   * mounts the same sections under its own path, so the links are built from
   * this rather than hardcoded to one role.
   */
  basePath,
  children,
}: {
  active?: string;
  basePath: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-ink/60 text-sm mt-1">Manage your account and preferences.</p>
      </div>
      <div className="flex flex-col md:flex-row gap-6">
        <nav className="md:w-52 shrink-0 flex md:flex-col gap-1 overflow-x-auto">
          {NAV.map((item) => {
            const on = item.key === active;
            if (!item.ready) {
              return (
                <span key={item.key} className="rounded-md px-3 py-1.5 text-[13px] text-ink/30 cursor-default shrink-0" title="Coming soon">
                  {item.label}
                </span>
              );
            }
            return (
              <Link
                key={item.key}
                href={`${basePath}${item.path}`}
                className={`rounded-md px-3 py-1.5 text-[13px] shrink-0 ${on ? "font-semibold bg-cream" : "text-ink/60 hover:bg-cream"}`}
                style={on ? { color: "var(--pt-accent)" } : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
