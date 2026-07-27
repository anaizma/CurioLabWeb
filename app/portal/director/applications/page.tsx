import Link from "next/link";
import { getApplicationsView, getTerms, gradeLabel, type ApplicationStatus } from "@/lib/portal/director/applications-data";
import ApplicationsControls from "@/components/portal/director/ApplicationsControls";
import AutoRefresh from "@/components/portal/director/AutoRefresh";
import LoadFailed from "@/components/portal/LoadFailed";
import { requireDirector } from "@/lib/portal/director/guard";

const STATUS_LABEL: Record<ApplicationStatus, string> = {
  interested: "Interested",
  submitted: "Submitted",
  screening: "Screening",
  interview: "Interview",
  accepted: "Accepted",
  declined: "Declined",
};

// Each status carries its own soft-badge color (bg + readable fg). Interested is
// neutral gray; the rest are distinct so the list scans at a glance.
const STATUS_COLOR: Record<ApplicationStatus, { bg: string; fg: string }> = {
  interested: { bg: "#EEF0F2", fg: "#55606B" },
  submitted: { bg: "#E4EDFB", fg: "#2456B8" },
  screening: { bg: "#FBF0DA", fg: "#8A5A00" },
  interview: { bg: "#EEE7FB", fg: "#6B39B6" },
  accepted: { bg: "#E1F3E7", fg: "#1E7A45" },
  declined: { bg: "#FBE6E8", fg: "#B23345" },
};

// Single (full) column template - the header row and every row share it so columns line up.
const COLS = "minmax(0,1.5fr) minmax(0,1.5fr) minmax(0,2fr) minmax(0,1.3fr) 6rem 5.5rem";

function StatusBadge({ status }: { status: ApplicationStatus }) {
  const c = STATUS_COLOR[status];
  return (
    <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap" style={{ background: c.bg, color: c.fg }}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ term?: string }> }) {
  // Gate first: nothing below this line runs for a non-director (see guard.ts).
  await requireDirector();
  const { term } = await searchParams;
  const [{ terms }, appsView] = await Promise.all([
    getTerms(),
    getApplicationsView({ termId: term }),
  ]);
  const { applications, activeTermId, activeTermName, state } = appsView;
  const showingAll = term === "all";

  // The "not signed in" redirect that used to live here is gone: requireDirector()
  // above is now the ONE place that decides, so this page can no longer disagree
  // with it. A `state` of "unauthenticated" past the gate means the ops read
  // itself was refused, which is a load failure, not a sign-in problem.
  const selfHref = `/portal/director/applications${term ? `?term=${encodeURIComponent(term)}` : ""}`;

  return (
    <div className="flex flex-col gap-6">
      {/* Only poll when there is live data to refresh; polling a failed read
          would just retry silently and hide the failure from the director. */}
      {state === "ok" && <AutoRefresh intervalMs={20000} />}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Applications</h1>
          <p className="text-ink/60 text-sm mt-1">Review and advance applications for this chapter.</p>
        </div>
        {state === "ok" && <ApplicationsControls terms={terms} activeTermId={activeTermId} />}
      </div>
      {state !== "ok" ? (
        <LoadFailed what="your applications" retryHref={selfHref} />
      ) : applications.length === 0 ? (
        <p className="text-sm text-ink/50 rounded-sm border border-ink/10 bg-white px-4 py-6 text-center">
          No applications{showingAll ? "" : activeTermName ? ` for ${activeTermName}` : ""}.
        </p>
      ) : (
        <div className="rounded-sm border border-ink/10 bg-white overflow-x-auto">
          <div style={{ minWidth: "56rem" }}>
            {/* Header row */}
            <div className="grid items-center gap-3 px-4 py-2.5" style={{ gridTemplateColumns: COLS }}>
              <div className="label text-[10.5px]">Name</div>
              <div className="label text-[10.5px]">School</div>
              <div className="label text-[10.5px]">Email</div>
              <div className="label text-[10.5px]">Parent</div>
              <div className="label text-[10.5px]">Date</div>
              <div className="label text-[10.5px] justify-self-end">Status</div>
            </div>

            {/* Rows: real applications link to their detail; Interested leads are informational (no detail page). */}
            {applications.map((a) => {
              const grade = gradeLabel(a.gradeLevel);
              const cells = (
                <>
                  {/* Name - a lead has no student name yet, so show its email + a parent/student tag. */}
                  <div className="flex items-center gap-2 min-w-0">
                    {a.isLead ? (
                      <>
                        <span className="text-sm font-mono truncate">{a.contactEmail || "—"}</span>
                        {a.fillerRole && (
                          <span className="text-[10.5px] font-semibold rounded px-1.5 py-0.5 bg-ink/5 text-ink/60 shrink-0 capitalize">{a.fillerRole}</span>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="text-sm font-medium truncate">{a.studentName}</span>
                        {grade && <span className="text-[10.5px] font-mono rounded px-1.5 py-0.5 bg-ink/5 text-ink/60 shrink-0">{grade}</span>}
                      </>
                    )}
                    {a.duplicateFlag && (
                      <span
                        className="text-[10px] font-semibold rounded-full px-1.5 py-0.5 whitespace-nowrap shrink-0"
                        style={{ background: "#FBF0DA", color: "#8A5A00" }}
                        title="Possible duplicate applicant (name + date of birth match)"
                      >
                        Possible duplicate
                      </span>
                    )}
                  </div>
                  {/* Full columns */}
                  <div className="text-xs text-ink/55 truncate">{a.school || "—"}</div>
                  <div className="text-xs text-ink/55 font-mono truncate">{a.contactEmail || "—"}</div>
                  <div className="text-xs text-ink/55 truncate">{a.guardianName || "—"}</div>
                  {/* Date - effective time of the current status */}
                  <div className="text-xs text-ink/55 whitespace-nowrap">
                    {a.statusDateLabel}
                    {showingAll && a.termName ? <span className="block text-ink/40">{a.termName}</span> : null}
                  </div>
                  {/* Status */}
                  <div className="justify-self-end">
                    <StatusBadge status={a.status} />
                  </div>
                </>
              );
              return a.isLead ? (
                <div key={a.applicationId} className="grid items-center gap-3 px-4 py-3" style={{ gridTemplateColumns: COLS }}>
                  {cells}
                </div>
              ) : (
                <Link
                  key={a.applicationId}
                  href={`/portal/director/applications/${a.applicationId}`}
                  className="grid items-center gap-3 px-4 py-3 hover:bg-cream transition-colors"
                  style={{ gridTemplateColumns: COLS }}
                >
                  {cells}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
