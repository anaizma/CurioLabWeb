import type { StudentProfile } from "@/lib/portal/types";

export default function ProfileIntro({ p }: { p: StudentProfile }) {
  if (!p.narrative) {
    return (
      <div className="bg-white border border-black/[.08] rounded-lg p-4">
        <div className="label text-[10.5px] mb-2">Intro</div>
        <p className="text-muted text-[13px]">No intro yet — write a line about what you build.</p>
      </div>
    );
  }
  return (
    <div className="bg-white border border-black/[.08] rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="label text-[10.5px]">Intro</div>
        {p.narrative.status === "pending_review" && (
          <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: "#8A5B00", background: "#FFF4E0", border: "1px solid #F5DFB0", padding: "2px 7px", borderRadius: "999px" }}>Edit in review</span>
        )}
      </div>
      <p className="text-[13.5px] leading-relaxed">{p.narrative.body}</p>
    </div>
  );
}
