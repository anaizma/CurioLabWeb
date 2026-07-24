import { getRequestsView } from "@/lib/portal/director/requests-data";
import SampleBanner from "@/components/portal/SampleBanner";
import OpsActionButton from "@/components/portal/director/OpsActionButton";

export default async function RequestsPage() {
  const { deletions, exportRequests, isSample } = await getRequestsView();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Deletion & export requests</h1>
        <p className="text-ink/60 text-sm mt-1">Guardian data requests awaiting review and fulfillment.</p>
      </div>
      {isSample && <SampleBanner />}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold text-ink/70">Deletion requests</h2>
        {deletions.length === 0 ? (
          <p className="text-sm text-ink/50">None open.</p>
        ) : (
          deletions.map((d) => (
            <div key={d.deletionRequestId} className="rounded-xl border border-ink/10 bg-white p-4 flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium">{d.subjectName}</div>
                <div className="text-xs text-ink/50">{d.status} · requested {d.requestedLabel}</div>
              </div>
              {isSample ? (
                <div className="flex gap-2 shrink-0">
                  <button type="button" disabled className="rounded-lg px-3 py-1.5 text-xs font-semibold border border-ink/15 text-ink/40 disabled:opacity-60">Review</button>
                  <button type="button" disabled className="rounded-lg px-3 py-1.5 text-xs font-semibold border border-ink/15 text-ink/40 disabled:opacity-60">Fulfill</button>
                </div>
              ) : (
                <div className="flex gap-2 shrink-0">
                  <OpsActionButton method="POST" url={`/api/ops/deletion-requests/${d.deletionRequestId}/review`} label="Review" variant="outline" />
                  <OpsActionButton method="POST" url={`/api/ops/deletion-requests/${d.deletionRequestId}/fulfill`} body={{ decision: "full" }} label="Fulfill (full)" variant="accent" confirmText="Fulfill full deletion? This cannot be undone." />
                  <OpsActionButton method="POST" url={`/api/ops/deletion-requests/${d.deletionRequestId}/fulfill`} body={{ decision: "refused" }} label="Refuse" variant="outline" confirmText="Refuse this deletion request?" />
                </div>
              )}
            </div>
          ))
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold text-ink/70">Export requests</h2>
        {exportRequests.length === 0 ? (
          <p className="text-sm text-ink/50">None open.</p>
        ) : (
          exportRequests.map((x) => (
            <div key={x.exportRequestId} className="rounded-xl border border-ink/10 bg-white p-4 flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium">{x.subjectName}</div>
                <div className="text-xs text-ink/50">{x.status} · requested {x.requestedLabel}</div>
              </div>
              {isSample ? (
                <button type="button" disabled className="rounded-lg px-3 py-1.5 text-xs font-semibold border border-ink/15 text-ink/40 disabled:opacity-60 shrink-0">Fulfill</button>
              ) : (
                <span className="shrink-0">
                  <OpsActionButton method="POST" url={`/api/ops/export-requests/${x.exportRequestId}/fulfill`} label="Fulfill" variant="accent" confirmText="Fulfill this export request?" />
                </span>
              )}
            </div>
          ))
        )}
      </section>

      <p className="text-xs text-ink/40">Actions connect to POST /api/ops/deletion-requests/&#123;id&#125;/review|fulfill and /api/ops/export-requests/&#123;id&#125;/fulfill once the list GETs supply live rows.</p>
    </div>
  );
}
