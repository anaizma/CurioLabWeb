import type { StudentProfile } from "@/lib/portal/types";

export default function ProfileHero({ p }: { p: StudentProfile }) {
  const stats = [
    { v: p.stats.verifiedProjects, s: "Verified projects" },
    { v: p.stats.sessions, s: "Sessions attended" },
    { v: p.stats.inNewsletter, s: "In the newsletter" },
    { v: p.stats.tier, s: "Current tier" },
  ];
  return (
    <div className="bg-white border border-black/10 rounded-xl overflow-hidden">
      <div className="h-[70px]" style={{ background: "var(--pt-banner)" }} />
      <div className="px-6 pb-5 -mt-7 flex gap-4 items-end flex-wrap">
        <div className="w-[70px] h-[70px] rounded-xl border-[3px] border-white grid place-items-center text-white text-2xl font-semibold"
             style={{ background: "var(--pt-accent)" }}>{p.initial}</div>
        <div className="flex-1 min-w-[180px]">
          <h1 className="text-2xl font-bold tracking-tight">{p.displayName}</h1>
          <div className="text-muted text-sm">{[p.tier, p.chapterName, p.joinedLabel].filter(Boolean).join(" · ")}</div>
        </div>
        <div className="flex items-center gap-2">
          {p.verified && (
            <span className="label" style={{ color: "var(--pt-accent-fg)", background: "var(--pt-accent-soft)", border: "1px solid var(--pt-accent-border)", padding: "3px 8px", borderRadius: "999px" }}>
              CurioLab verified
            </span>
          )}
          <button type="button" className="text-sm font-medium px-3 py-1.5 rounded-md border border-black/15 hover:bg-black/[.03]">Share profile</button>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 border-t border-black/[.06]">
        {stats.map((st, i) => (
          <div key={i} className="px-5 py-3 border-r border-black/[.06] last:border-r-0">
            <div className="font-mono text-lg">{st.v}</div>
            <div className="text-xs text-muted">{st.s}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
