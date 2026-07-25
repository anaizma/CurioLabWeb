import Link from "next/link";
import { getApplicationsView, getTerms, gradeLabel, type ApplicationStatus } from "@/lib/portal/director/applications-data";
import ApplicationsControls from "@/components/portal/director/ApplicationsControls";
import SampleBanner from "@/components/portal/SampleBanner";

const STATUS_LABEL: Record<ApplicationStatus, string> = {
  submitted: "Submitted",
  screening: "Screening",
  interview: "Interview",
  accepted: "Accepted",
  declined: "Declined",
};

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ term?: string; view?: string }> }) {
  const { term, view } = await searchParams;
  const full = view === "full";
  const [{ terms }, appsView] = await Promise.all([
    getTerms(),
    getApplicationsView({ termId: term, full }),
  ]);
  const { applications, activeTermId, activeTermName, isSample } = appsView;
  const showingAll = term === "all";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Applications</h1>
          <p className="text-ink/60 text-sm mt-1">Review and advance applications for this chapter.</p>
        </div>
        <ApplicationsControls terms={terms} activeTermId={activeTermId} view={full ? "full" : "partial"} />
      </div>
      {isSample && <SampleBanner />}
      {applications.length === 0 ? (
        <p className="text-sm text-ink/50 rounded-xl border border-ink/10 bg-white px-4 py-6 text-center">
          No applications{showingAll ? "" : activeTermName ? ` for ${activeTermName}` : ""}.
        </p>
      ) : (
        <ul className="rounded-xl border border-ink/10 bg-white divide-y divide-ink/5">
          {applications.map((a) => {
            const grade = gradeLabel(a.gradeLevel);
            return (
              <li key={a.applicationId}>
                <Link
                  href={`/portal/director/applications/${a.applicationId}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-cream transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{a.studentName}</span>
                      {grade && (
                        <span className="text-[10.5px] font-mono rounded px-1.5 py-0.5 bg-ink/5 text-ink/60 shrink-0">{grade}</span>
                      )}
                    </div>
                    <div className="text-xs text-ink/50 mt-0.5">
                      applied {a.submittedLabel}
                      {showingAll && a.termName ? ` · ${a.termName}` : ""}
                    </div>
                    {/* Full view adds the applicant's non-answer info (parent, school, contact). */}
                    {full && (
                      <div className="text-xs text-ink/45 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                        {a.guardianName && <span>Parent: {a.guardianName}</span>}
                        {a.school && <span>{a.school}</span>}
                        {a.contactEmail && <span className="font-mono">{a.contactEmail}</span>}
                      </div>
                    )}
                  </div>
                  <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 shrink-0" style={{ background: "var(--pt-accent-soft)", color: "var(--pt-accent-fg)" }}>
                    {STATUS_LABEL[a.status]}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
