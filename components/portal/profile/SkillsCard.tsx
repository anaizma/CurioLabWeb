import type { StudentProfile } from "@/lib/portal/types";

export default function SkillsCard({ p }: { p: StudentProfile }) {
  if (p.skills.length === 0) return null;
  return (
    <div className="bg-white border border-black/[.08] rounded-lg p-4">
      <div className="label text-[10.5px] mb-3">Skills</div>
      <div className="flex flex-wrap gap-1.5">
        {p.skills.map((s) => (
          <span key={s} className="font-mono text-[11px] px-2 py-1 rounded border border-black/[.10] text-muted bg-black/[.02]">{s}</span>
        ))}
      </div>
    </div>
  );
}
