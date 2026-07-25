import Link from "next/link";
import { getApplicationDetail, gradeLabel } from "@/lib/portal/director/applications-data";
import SampleBanner from "@/components/portal/SampleBanner";
import OpsActionButton from "@/components/portal/director/OpsActionButton";

const ACTIONS = ["Screen", "Schedule interview", "Accept", "Decline"];

function InfoField({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <div className="label text-[10.5px] text-ink/40">{label}</div>
      <p className="text-sm mt-0.5">{value}</p>
    </div>
  );
}

export default async function ApplicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { detail, isSample } = await getApplicationDetail(id);
  if (!detail) {
    return <p className="text-sm text-ink/50">Application not found.</p>;
  }
  const grade = gradeLabel(detail.gradeLevel);
  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <Link href="/portal/director/applications" className="text-xs font-semibold" style={{ color: "var(--pt-accent)" }}>
        ← All applications
      </Link>
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-bold">{detail.studentName}</h1>
          {grade && <span className="text-[11px] font-mono rounded px-1.5 py-0.5 bg-ink/5 text-ink/60">{grade}</span>}
        </div>
        <p className="text-ink/60 text-sm mt-1">
          submitted {detail.submittedLabel}
          {detail.termName ? ` · ${detail.termName}` : ""}
        </p>
      </div>
      {isSample && <SampleBanner />}
      {/* Applicant info the director needs to process the application (full PII, own chapter only). */}
      <div className="rounded-sm border border-ink/10 bg-white p-5 grid grid-cols-2 gap-x-6 gap-y-4">
        <InfoField label="Guardian" value={detail.guardianName} />
        <InfoField label="Guardian email" value={detail.guardianEmail} />
        <InfoField label="School" value={detail.school} />
        <InfoField label="Contact email" value={detail.contactEmail} />
      </div>
      <div className="rounded-sm border border-ink/10 bg-white p-5 flex flex-col gap-4">
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
