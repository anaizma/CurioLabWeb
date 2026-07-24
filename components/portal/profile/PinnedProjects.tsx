import type { StudentProfile } from "@/lib/portal/types";

export default function PinnedProjects({ p }: { p: StudentProfile }) {
  if (p.projects.length === 0) {
    return (
      <div className="bg-white border border-black/10 rounded-xl p-5">
        <div className="label mb-2">Pinned projects</div>
        <p className="text-muted text-sm">Your verified projects will show here.</p>
      </div>
    );
  }
  return (
    <div className="bg-white border border-black/10 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="label">Pinned projects</div>
        <button type="button" className="text-xs font-medium px-2.5 py-1 rounded-md border border-black/15 hover:bg-black/[.03]">Choose pins</button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {p.projects.map((pr) => {
          const verified = pr.status === "verified" || pr.status === "public_listed";
          return (
            <div key={pr.id} className="border border-black/10 rounded-lg p-3.5">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-[14.5px] font-semibold">{pr.title}</h4>
                <span className="label" style={verified
                  ? { color: "var(--pt-accent-fg)", background: "var(--pt-accent-soft)", border: "1px solid var(--pt-accent-border)", padding: "2px 8px", borderRadius: "999px" }
                  : { color: "#8A5B00", background: "#FFF4E0", border: "1px solid #F5DFB0", padding: "2px 8px", borderRadius: "999px" }}>
                  {verified ? "Verified" : "In review"}
                </span>
              </div>
              <p className="text-[13px] text-muted my-2 min-h-[34px]">{pr.summary}</p>
              <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
                <span className="w-2 h-2 rounded-full" style={{ background: "var(--pt-chip)" }} />
                {[pr.language, pr.dateLabel].filter(Boolean).join(" · ")}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
