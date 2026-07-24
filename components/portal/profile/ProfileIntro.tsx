import type { StudentProfile } from "@/lib/portal/types";

export default function ProfileIntro({ p }: { p: StudentProfile }) {
  if (!p.narrative && p.skills.length === 0) {
    return (
      <div className="bg-white border border-black/10 rounded-xl p-5">
        <div className="label mb-2">Intro</div>
        <p className="text-muted text-sm">No intro yet — write a line about what you build.</p>
      </div>
    );
  }
  return (
    <div className="bg-white border border-black/10 rounded-xl p-5">
      <div className="flex items-center justify-between mb-2">
        <div className="label">Intro</div>
        {p.narrative?.status === "pending_review" && (
          <span className="label" style={{ color: "#8A5B00", background: "#FFF4E0", border: "1px solid #F5DFB0", padding: "3px 8px", borderRadius: "999px" }}>Edit in review</span>
        )}
      </div>
      {p.narrative && <p className="text-[15px]">{p.narrative.body}</p>}
      {p.skills.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-black/[.06]">
          {p.skills.map((s) => (
            <span key={s} className="text-xs px-2.5 py-1 rounded-full border border-black/15 text-muted">{s}</span>
          ))}
        </div>
      )}
    </div>
  );
}
