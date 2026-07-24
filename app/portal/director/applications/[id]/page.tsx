import Link from "next/link";
import { getApplicationDetail } from "@/lib/portal/director/applications-data";
import SampleBanner from "@/components/portal/SampleBanner";
import OpsActionButton from "@/components/portal/director/OpsActionButton";

const ACTIONS = ["Screen", "Schedule interview", "Accept", "Decline"];

export default async function ApplicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { detail, isSample } = await getApplicationDetail(id);
  if (!detail) {
    return <p className="text-sm text-ink/50">Application not found.</p>;
  }
  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <Link href="/portal/director/applications" className="text-xs font-semibold" style={{ color: "var(--pt-accent)" }}>
        ← All applications
      </Link>
      <div>
        <h1 className="text-2xl font-bold">{detail.studentDisplayName}</h1>
        <p className="text-ink/60 text-sm mt-1">Guardian: {detail.guardianDisplayName} · submitted {detail.submittedLabel}</p>
      </div>
      {isSample && <SampleBanner />}
      <div className="rounded-xl border border-ink/10 bg-white p-5 flex flex-col gap-4">
        {detail.answers.map((qa, i) => (
          <div key={i}>
            <div className="label text-[11px] text-ink/40">{qa.question}</div>
            <p className="text-sm mt-1">{qa.answer}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {isSample ? (
          <>
            <div className="flex flex-wrap gap-2">
              {ACTIONS.map((label) => (
                <button key={label} type="button" disabled className="rounded-lg px-3 py-1.5 text-sm font-semibold border border-ink/15 text-ink/40 disabled:opacity-60">
                  {label}
                </button>
              ))}
            </div>
            <p className="text-xs text-ink/40">Actions activate once GET /api/ops/applications connects live data.</p>
          </>
        ) : (
          <div className="flex flex-wrap gap-2">
            <OpsActionButton method="PATCH" url={`/api/ops/applications/${detail.applicationId}`} body={{ action: "screen" }} label="Screen" variant="outline" />
            <OpsActionButton method="PATCH" url={`/api/ops/applications/${detail.applicationId}`} body={{ action: "schedule-interview" }} label="Schedule interview" variant="outline" />
            <OpsActionButton method="PATCH" url={`/api/ops/applications/${detail.applicationId}`} body={{ action: "accept" }} label="Accept" variant="accent" />
            <OpsActionButton method="PATCH" url={`/api/ops/applications/${detail.applicationId}`} body={{ action: "decline" }} label="Decline" variant="outline" confirmText="Decline this application?" />
          </div>
        )}
      </div>
    </div>
  );
}
