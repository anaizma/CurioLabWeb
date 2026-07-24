import { getMediaView } from "@/lib/portal/director/media-data";
import SampleBanner from "@/components/portal/SampleBanner";
import OpsActionButton from "@/components/portal/director/OpsActionButton";

const ACTIONS = ["Confirm depiction", "Clear", "Remove"];

export default async function MediaPage() {
  const { media, isSample } = await getMediaView();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Media review</h1>
        <p className="text-ink/60 text-sm mt-1">Submitted media awaiting depiction confirmation or clearance.</p>
      </div>
      {isSample && <SampleBanner />}
      {media.length === 0 ? (
        <p className="text-sm text-ink/50">Nothing awaiting review.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {media.map((m) => (
            <div key={m.mediaId} className="rounded-xl border border-ink/10 bg-white p-4 flex flex-col gap-3">
              <div>
                <div className="text-sm font-medium">{m.projectTitle}</div>
                <div className="text-xs text-ink/50 mt-0.5">
                  {m.reviewStatus} · {m.depictionsCount} depiction{m.depictionsCount === 1 ? "" : "s"}
                </div>
                {m.flaggedReason && <div className="text-[11px] mt-1" style={{ color: "var(--pt-accent-fg)" }}>{m.flaggedReason}</div>}
              </div>
              {isSample ? (
                <div className="flex flex-wrap gap-2">
                  {ACTIONS.map((label) => (
                    <button key={label} type="button" disabled className="rounded-lg px-3 py-1.5 text-xs font-semibold border border-ink/15 text-ink/40 disabled:opacity-60">
                      {label}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled className="rounded-lg px-3 py-1.5 text-xs font-semibold border border-ink/15 text-ink/40 disabled:opacity-60">Confirm depiction</button>
                    <OpsActionButton method="POST" url={`/api/ops/media/${m.mediaId}/clear`} label="Clear" variant="accent" />
                    <OpsActionButton method="POST" url={`/api/ops/media/${m.mediaId}/remove`} label="Remove" variant="outline" confirmText="Remove this media?" />
                  </div>
                  <span className="text-[10px] text-ink/40">Confirm depiction available in the review detail.</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-ink/40">Actions connect to POST /api/ops/media/&#123;id&#125;/confirm-depiction|clear|remove once GET /api/ops/media/review-queue supplies live rows.</p>
    </div>
  );
}
