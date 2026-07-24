import { getGuardianView } from "@/lib/portal/guardian/guardian-data";
import SampleBanner from "@/components/portal/SampleBanner";

export default async function GuardianActivityPage() {
  const v = await getGuardianView();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">{v.child.displayName}&apos;s public activity</h1>
        <p className="text-ink/60 text-sm mt-1">
          This is everything of {v.child.displayName}&apos;s that&apos;s visible outside CurioLab. Drafts and private posts are never shown here.
        </p>
      </div>
      {v.isSample && <SampleBanner />}
      {v.publicItems.length === 0 ? (
        <p className="text-sm text-ink/50">Nothing of {v.child.displayName}&apos;s is public yet.</p>
      ) : (
        <div className="rounded-xl border border-ink/10 bg-white divide-y divide-ink/5">
          {v.publicItems.map((it) => (
            <div key={it.id} className="px-4 py-3 flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium">{it.title}</div>
                <div className="text-xs text-ink/50">{it.kind} · {it.dateLabel}</div>
              </div>
              <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 shrink-0" style={{ background: "var(--pt-accent-soft)", color: "var(--pt-accent-fg)" }}>
                {it.surfaceLabel}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
