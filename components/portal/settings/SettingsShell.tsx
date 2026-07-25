import type { ReactNode } from "react";

// Settings has room for several sections; only "My Information" is built today.
const NAV = [
  { key: "my-information", label: "My information", ready: true },
  { key: "security", label: "Account & security", ready: false },
  { key: "notifications", label: "Notifications", ready: false },
  { key: "privacy", label: "Privacy", ready: false },
];

export default function SettingsShell({ active = "my-information", children }: { active?: string; children: ReactNode }) {
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
              <span key={item.key} className={`rounded-md px-3 py-1.5 text-[13px] shrink-0 ${on ? "font-semibold bg-cream" : "text-ink/60"}`} style={on ? { color: "var(--pt-accent)" } : undefined}>
                {item.label}
              </span>
            );
          })}
        </nav>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
