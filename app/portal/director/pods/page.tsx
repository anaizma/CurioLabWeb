import { getPodsView } from "@/lib/portal/director/pods-data";
import SampleBanner from "@/components/portal/SampleBanner";
import { requireDirector } from "@/lib/portal/director/guard";

export default async function PodsPage() {
  // Gate first: nothing below this line runs for a non-director (see guard.ts).
  await requireDirector();
  const { terms, pods, isSample } = await getPodsView();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Pods & terms</h1>
        <p className="text-ink/60 text-sm mt-1">Terms structure the calendar; pods group members under a mentor.</p>
      </div>
      {isSample && <SampleBanner />}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-ink/70">Terms</h2>
          <button type="button" disabled className="rounded-lg px-3 py-1.5 text-xs font-semibold border border-ink/15 text-ink/40 disabled:opacity-60">New term</button>
        </div>
        <div className="rounded-sm border border-ink/10 bg-white divide-y divide-ink/5">
          {terms.map((t) => (
            <div key={t.termId} className="px-4 py-3 flex items-center justify-between gap-4 text-sm">
              <span className="font-medium">{t.name}</span>
              <span className="text-xs text-ink/50">{t.startsLabel} – {t.endsLabel}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-ink/70">Pods</h2>
          <button type="button" disabled className="rounded-lg px-3 py-1.5 text-xs font-semibold border border-ink/15 text-ink/40 disabled:opacity-60">New pod</button>
        </div>
        <div className="rounded-sm border border-ink/10 bg-white divide-y divide-ink/5">
          {pods.map((p) => (
            <div key={p.podId} className="px-4 py-3 flex items-center justify-between gap-4 text-sm">
              <div>
                <div className="font-medium">
                  {p.name} <span className="text-ink/40 font-normal text-xs">· {p.termName}</span>
                </div>
                <div className="text-xs text-ink/50">Mentor: {p.mentorName} · {p.memberCount} members</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <p className="text-xs text-ink/40">Create/assign connect to POST /api/ops/terms and /api/ops/pods once GET /api/ops/terms and /api/ops/pods supply live rows.</p>
    </div>
  );
}
