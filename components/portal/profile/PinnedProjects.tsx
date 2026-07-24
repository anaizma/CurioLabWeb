import type { StudentProfile } from "@/lib/portal/types";

export default function PinnedProjects({ p }: { p: StudentProfile }) {
  if (p.projects.length === 0) {
    return (
      <div className="bg-white border border-black/[.08] rounded-lg p-4">
        <div className="label text-[10.5px] mb-2">Pinned projects</div>
        <p className="text-muted text-[13px]">Your verified projects will show here.</p>
      </div>
    );
  }
  return (
    <div className="bg-white border border-black/[.08] rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="label text-[10.5px]">Pinned projects</div>
        <button type="button" className="text-[11px] font-medium px-2 py-0.5 rounded border border-black/15 hover:bg-black/[.03]">Edit pins</button>
      </div>
      <div className="flex flex-col gap-2.5">
        {p.projects.map((pr) => {
          const verified = pr.status === "verified" || pr.status === "public_listed";
          return (
            <div key={pr.id} className="border border-black/[.08] rounded-md p-3">
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-mono text-[13px] font-semibold">{pr.title}</h4>
                <span className="font-mono text-[9.5px] uppercase tracking-wider" style={verified
                  ? { color: "var(--pt-accent-fg)", background: "var(--pt-accent-soft)", border: "1px solid var(--pt-accent-border)", padding: "2px 6px", borderRadius: "999px" }
                  : { color: "#8A5B00", background: "#FFF4E0", border: "1px solid #F5DFB0", padding: "2px 6px", borderRadius: "999px" }}>
                  {verified ? "Verified" : "In review"}
                </span>
              </div>
              <p className="text-[12px] text-muted my-1.5 leading-relaxed">{pr.summary}</p>
              <div className="flex items-center gap-1.5 font-mono text-[10.5px] text-muted">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--pt-chip)" }} />
                {[pr.language, pr.dateLabel].filter(Boolean).join(" · ")}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
