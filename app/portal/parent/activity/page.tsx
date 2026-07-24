import { getGuardianView } from "@/lib/portal/guardian/guardian-data";
import SampleBanner from "@/components/portal/SampleBanner";
import type { ActivityVisibility } from "@/lib/portal/guardian/types";

const VIS_STYLE: Record<ActivityVisibility, { bg: string; fg: string }> = {
  chapter: { bg: "#eef0f2", fg: "#44515f" },
  community: { bg: "var(--pt-accent-soft)", fg: "var(--pt-accent-fg)" },
  newsletter: { bg: "#e7f2ea", fg: "#2f7a4d" },
};

export default async function GuardianActivityPage() {
  const v = await getGuardianView();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">{v.child.displayName}&apos;s activity</h1>
        <p className="text-ink/60 text-sm mt-1">
          Everything {v.child.displayName} has shared — inside their chapter and publicly. Unshared drafts and direct messages are never shown here.
        </p>
      </div>
      {v.isSample && <SampleBanner />}
      <div className="flex flex-col gap-3">
        {v.activity.map((it) => {
          const s = VIS_STYLE[it.visibility];
          return (
            <div key={it.id} className="rounded-xl border border-ink/10 bg-white p-4 flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium">{it.title}</div>
                <div className="text-xs text-ink/50">{it.kind} · {it.dateLabel}</div>
              </div>
              <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 shrink-0" style={{ background: s.bg, color: s.fg }}>
                {it.visibilityLabel}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-ink/40">Chapter only stays inside CurioLab; Community page and Newsletter are public.</p>
    </div>
  );
}
