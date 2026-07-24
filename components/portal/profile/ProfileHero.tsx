import type { StudentProfile } from "@/lib/portal/types";

export default function ProfileHero({ p }: { p: StudentProfile }) {
  const stats = [
    { s: "Verified projects", v: p.stats.verifiedProjects },
    { s: "Sessions attended", v: p.stats.sessions },
    { s: "In newsletter", v: p.stats.inNewsletter },
  ];
  return (
    <div className="bg-white border border-black/[.08] rounded-lg overflow-hidden">
      <div className="h-14" style={{ background: "var(--pt-banner)" }} />
      <div className="px-4 pb-4 -mt-6">
        <div className="flex items-end justify-between gap-2">
          <div className="w-12 h-12 rounded-md border-2 border-white grid place-items-center text-white text-lg font-bold" style={{ background: "var(--pt-accent)" }}>{p.initial}</div>
          {p.verified && (
            <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--pt-accent-fg)", background: "var(--pt-accent-soft)", border: "1px solid var(--pt-accent-border)", padding: "2px 7px", borderRadius: "999px" }}>&#10022; Verified</span>
          )}
        </div>
        <h1 className="text-lg font-bold tracking-tight mt-2.5">{p.displayName}</h1>
        <div className="font-mono text-[11px] text-muted mt-0.5 leading-relaxed">
          {[p.tier, p.chapterName].filter(Boolean).join(" · ")}
          <br />
          {p.joinedLabel}
        </div>
        <div className="mt-4 flex flex-col gap-2">
          {stats.map((st) => (
            <div key={st.s} className="flex items-center justify-between text-[12.5px]">
              <span className="text-muted">{st.s}</span>
              <span className="font-mono font-semibold">{st.v}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between border border-black/[.08] rounded-md px-3 py-2">
          <span className="text-[12px] text-muted">Current tier</span>
          <span className="font-mono text-[12.5px] font-semibold" style={{ color: "var(--pt-accent-fg)" }}>{p.stats.tier}</span>
        </div>
        <button type="button" className="mt-3 w-full text-[12.5px] font-medium px-3 py-2 rounded-md border border-black/15 hover:bg-black/[.03] transition-colors">Share profile &#8599;</button>
      </div>
    </div>
  );
}
