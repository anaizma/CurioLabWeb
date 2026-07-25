import Link from "next/link";
import { getApplicationsView, gradeLabel, type ApplicationStatus } from "@/lib/portal/director/applications-data";
import SampleBanner from "@/components/portal/SampleBanner";

const STATUS_LABEL: Record<ApplicationStatus, string> = {
  submitted: "Submitted",
  screening: "Screening",
  interview: "Interview",
  accepted: "Accepted",
  declined: "Declined",
};

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ terms?: string }> }) {
  const { terms } = await searchParams;
  const allTerms = terms === "all";
  const { applications, activeTermName, isSample } = await getApplicationsView({ allTerms });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Applications</h1>
          <p className="text-ink/60 text-sm mt-1">Review and advance applications for this chapter.</p>
        </div>
        {/* Backend now defaults to the most-recent term; toggle to see every term. */}
        <div className="flex items-center gap-1 rounded-lg border border-ink/10 bg-white p-0.5 text-xs font-semibold shrink-0">
          <Link
            href="/portal/director/applications"
            className="rounded-md px-2.5 py-1 transition-colors"
            style={!allTerms ? { background: "var(--pt-accent-soft)", color: "var(--pt-accent-fg)" } : { color: "var(--color-ink)", opacity: 0.6 }}
          >
            {activeTermName ?? "Current term"}
          </Link>
          <Link
            href="/portal/director/applications?terms=all"
            className="rounded-md px-2.5 py-1 transition-colors"
            style={allTerms ? { background: "var(--pt-accent-soft)", color: "var(--pt-accent-fg)" } : { color: "var(--color-ink)", opacity: 0.6 }}
          >
            All terms
          </Link>
        </div>
      </div>
      {isSample && <SampleBanner />}
      {applications.length === 0 ? (
        <p className="text-sm text-ink/50 rounded-xl border border-ink/10 bg-white px-4 py-6 text-center">
          No applications{allTerms ? "" : activeTermName ? ` for ${activeTermName}` : " for the current term"}.
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
                      submitted {a.submittedLabel}
                      {allTerms && a.termName ? ` · ${a.termName}` : ""}
                    </div>
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
