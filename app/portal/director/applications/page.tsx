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

// Shared column templates — the header row and every applicant row use the same
// template so the columns line up. No gridlines; alignment does the work.
const COLS_PARTIAL = "minmax(0,1fr) 6rem 5.5rem";
const COLS_FULL = "minmax(0,1.5fr) 5.5rem minmax(0,1.5fr) minmax(0,2fr) minmax(0,1.3fr) 5.5rem";

function StatusBadge({ status }: { status: ApplicationStatus }) {
  return (
    <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap" style={{ background: "var(--pt-accent-soft)", color: "var(--pt-accent-fg)" }}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ term?: string; view?: string }> }) {
  const { term, view } = await searchParams;
  const full = view === "full";
  const [{ terms }, appsView] = await Promise.all([
    getTerms(),
    getApplicationsView({ termId: term, full }),
  ]);
  const { applications, activeTermId, activeTermName, isSample } = appsView;
  const showingAll = term === "all";

  const cols = full ? COLS_FULL : COLS_PARTIAL;
  const minWidth = full ? "56rem" : "28rem";

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
        <p className="text-sm text-ink/50 rounded-sm border border-ink/10 bg-white px-4 py-6 text-center">
          No applications{showingAll ? "" : activeTermName ? ` for ${activeTermName}` : ""}.
        </p>
      ) : (
        <div className="rounded-sm border border-ink/10 bg-white overflow-x-auto">
          <div style={{ minWidth }}>
            {/* Header row */}
            <div className="grid items-center gap-3 px-4 py-2.5" style={{ gridTemplateColumns: cols }}>
              <div className="label text-[10.5px]">Name</div>
              <div className="label text-[10.5px]">Applied</div>
              {full && <div className="label text-[10.5px]">School</div>}
              {full && <div className="label text-[10.5px]">Email</div>}
              {full && <div className="label text-[10.5px]">Parent</div>}
              <div className="label text-[10.5px] justify-self-end">Status</div>
            </div>

            {/* Applicant rows */}
            {applications.map((a) => {
              const grade = gradeLabel(a.gradeLevel);
              return (
                <Link
                  key={a.applicationId}
                  href={`/portal/director/applications/${a.applicationId}`}
                  className="grid items-center gap-3 px-4 py-3 hover:bg-cream transition-colors"
                  style={{ gridTemplateColumns: cols }}
                >
                  {/* Name */}
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium truncate">{a.studentName}</span>
                    {grade && <span className="text-[10.5px] font-mono rounded px-1.5 py-0.5 bg-ink/5 text-ink/60 shrink-0">{grade}</span>}
                  </div>
                  {/* Applied */}
                  <div className="text-xs text-ink/55 whitespace-nowrap">
                    {a.submittedLabel}
                    {showingAll && a.termName ? <span className="block text-ink/40">{a.termName}</span> : null}
                  </div>
                  {/* Full-view columns: non-answer applicant info */}
                  {full && <div className="text-xs text-ink/55 truncate">{a.school || "—"}</div>}
                  {full && <div className="text-xs text-ink/55 font-mono truncate">{a.contactEmail || "—"}</div>}
                  {full && <div className="text-xs text-ink/55 truncate">{a.guardianName || "—"}</div>}
                  {/* Status */}
                  <div className="justify-self-end">
                    <StatusBadge status={a.status} />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
