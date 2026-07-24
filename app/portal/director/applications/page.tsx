import Link from "next/link";
import { getApplicationsView, type ApplicationStatus } from "@/lib/portal/director/applications-data";
import SampleBanner from "@/components/portal/SampleBanner";

const STATUS_LABEL: Record<ApplicationStatus, string> = {
  submitted: "Submitted",
  screening: "Screening",
  interview: "Interview",
  accepted: "Accepted",
  declined: "Declined",
};

export default async function ApplicationsPage() {
  const { applications, isSample } = await getApplicationsView();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Applications</h1>
        <p className="text-ink/60 text-sm mt-1">Review and advance applications for this chapter.</p>
      </div>
      {isSample && <SampleBanner />}
      <ul className="rounded-xl border border-ink/10 bg-white divide-y divide-ink/5">
        {applications.map((a) => (
          <li key={a.applicationId}>
            <Link
              href={`/portal/director/applications/${a.applicationId}`}
              className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-cream transition-colors"
            >
              <div>
                <div className="text-sm font-medium">{a.studentDisplayName}</div>
                <div className="text-xs text-ink/50">Guardian: {a.guardianDisplayName} · submitted {a.submittedLabel}</div>
              </div>
              <span className="text-[11px] font-semibold rounded-full px-2 py-0.5" style={{ background: "var(--pt-accent-soft)", color: "var(--pt-accent-fg)" }}>
                {STATUS_LABEL[a.status]}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
