import { getGuardianView } from "@/lib/portal/guardian/guardian-data";
import type { ActivityVisibility } from "@/lib/portal/guardian/types";

const VIS_STYLE: Record<ActivityVisibility, { bg: string; fg: string }> = {
  chapter: { bg: "#eef0f2", fg: "#44515f" },
  community: { bg: "var(--pt-accent-soft)", fg: "var(--pt-accent-fg)" },
  newsletter: { bg: "#e7f2ea", fg: "#2f7a4d" },
};

export default async function GuardianActivityPage() {
  const v = await getGuardianView();
  return (
    <div className="mx-auto max-w-3xl px-5 py-5 flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{v.child.displayName}&apos;s activity</h1>
        <p className="text-muted text-[13px] mt-1">Everything {v.child.displayName} has shared — inside the chapter and publicly. Unshared drafts and private notes are never shown here.</p>
      </div>
      {v.isSample && (
        <div className="text-[11px] font-mono text-muted border border-dashed border-black/15 rounded-md px-3 py-2">Sample data — sign in as a guardian to see real activity.</div>
      )}
      <div className="bg-white border border-black/[.08] rounded-lg divide-y divide-black/[.05]">
        {v.activity.map((it) => {
          const s = VIS_STYLE[it.visibility];
          return (
            <div key={it.id} className="px-3.5 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13.5px] font-medium">{it.title}</div>
                <div className="font-mono text-[10.5px] text-muted mt-0.5">{it.kind} · {it.dateLabel}</div>
              </div>
              <span className="font-mono text-[9.5px] uppercase tracking-wider rounded-full px-2 py-0.5 shrink-0" style={{ background: s.bg, color: s.fg }}>{it.visibilityLabel}</span>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-muted">Chapter only stays inside CurioLab; Community page and Newsletter are public.</p>
    </div>
  );
}
