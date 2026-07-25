import { getModerationView } from "@/lib/portal/director/moderation-data";
import SampleBanner from "@/components/portal/SampleBanner";

export default async function ModerationPage() {
  const { reports, isSample } = await getModerationView();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Moderation</h1>
        <p className="text-ink/60 text-sm mt-1">
          Open reports in The Lab for this chapter, most urgent first. Mentors act on these; you have oversight.
        </p>
      </div>
      {isSample && <SampleBanner />}
      {reports.length === 0 ? (
        <p className="text-sm text-ink/50">No open reports.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {reports.map((r) => (
            <li key={r.reportId} className="rounded-sm border border-ink/10 bg-white p-4 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className="text-[11px] font-semibold rounded-full px-2 py-0.5"
                    style={
                      r.reportClass === "safety"
                        ? { background: "var(--pt-accent-soft)", color: "var(--pt-accent-fg)" }
                        : { background: "#eef0f2", color: "#556" }
                    }
                  >
                    {r.reportClass === "safety" ? "Safety" : "Ordinary"}
                  </span>
                  {r.escalated && <span className="text-[11px] text-ink/50">escalated</span>}
                  {r.acknowledged && <span className="text-[11px] text-ink/50">acknowledged</span>}
                </div>
                <div className="text-sm font-medium mt-1">{r.reason}</div>
                <div className="text-xs text-ink/50 mt-0.5">
                  {r.targetType} · {r.targetId} · filed {r.filedLabel}
                </div>
              </div>
              <div className="text-xs text-ink/50 shrink-0">due {r.dueLabel}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
