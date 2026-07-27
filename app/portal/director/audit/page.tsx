import { getAuditView } from "@/lib/portal/director/audit-data";
import SampleBanner from "@/components/portal/SampleBanner";
import { requireDirector } from "@/lib/portal/director/guard";

export default async function AuditPage() {
  // Gate first: nothing below this line runs for a non-director (see guard.ts).
  await requireDirector();
  const { entries, isSample } = await getAuditView();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Audit log</h1>
        <p className="text-ink/60 text-sm mt-1">Recent recorded actions in this chapter.</p>
      </div>
      {isSample && <SampleBanner />}
      <div className="rounded-sm border border-ink/10 bg-white divide-y divide-ink/5">
        {entries.map((e) => (
          <div key={e.id} className="px-4 py-3 flex items-center justify-between gap-4 text-sm">
            <div>
              <span className="font-mono text-xs">{e.action}</span>
              <span className="text-ink/50 text-xs">
                {" "}
                · {e.subjectType}
                {e.subjectId ? ` · ${e.subjectId}` : ""}
              </span>
            </div>
            <div className="text-xs text-ink/50 shrink-0">{e.atLabel}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
