import Link from "next/link";
import { getApplicationDetail, gradeLabel } from "@/lib/portal/director/applications-data";
import LoadFailed from "@/components/portal/LoadFailed";
import OpsActionButton from "@/components/portal/director/OpsActionButton";
import { requireDirector } from "@/lib/portal/director/guard";

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
  // Gate first: nothing below this line runs for a non-director (see guard.ts).
  await requireDirector();
  const { id } = await params;
  const { detail, state } = await getApplicationDetail(id);

  // requireDirector() above is the ONE place that decides who may be here, so the
  // "not signed in" redirect this page used to carry is gone. Past the gate, any
  // non-ok state means the ops read itself was refused or failed.
  if (state !== "ok") {
    return <LoadFailed what="this application" retryHref={`/portal/director/applications/${id}`} />;
  }
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
      {detail.interview?.at && (
        <div className="rounded-sm px-4 py-2.5 text-[13px]" style={{ background: "var(--pt-accent-soft)", color: "var(--pt-accent-fg)" }}>
          <span className="font-semibold">Interview scheduled</span> · {detail.interview.at}
          {detail.interview.location ? ` · ${detail.interview.location}` : ""}
        </div>
      )}
      {detail.duplicate?.flagged && (
        <div
          className="rounded-sm px-4 py-2.5 text-[13px] flex items-center justify-between gap-3 flex-wrap"
          style={{ background: "#FBF0DA", color: "#8A5A00" }}
        >
          <div>
            <span className="font-semibold">Possible duplicate applicant.</span>{" "}
            Matches {detail.duplicate.ofApplicantName ?? "an existing application"} by name and date of birth.
            {detail.duplicate.ofApplicationId && (
              <>
                {" "}
                <Link
                  href={`/portal/director/applications/${detail.duplicate.ofApplicationId}`}
                  className="underline font-medium"
                >
                  View the other application
                </Link>
                .
              </>
            )}
          </div>
          <OpsActionButton
            method="PATCH"
            url={`/api/ops/applications/${detail.applicationId}`}
            body={{ action: "clear-duplicate-flag" }}
            label="Not a duplicate"
            variant="outline"
            confirmText="Dismiss the duplicate flag for this application?"
          />
        </div>
      )}
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
        <div className="flex flex-wrap gap-2">
          <OpsActionButton method="PATCH" url={`/api/ops/applications/${detail.applicationId}`} body={{ action: "screen" }} label="Screen" variant="outline" />
          <OpsActionButton method="PATCH" url={`/api/ops/applications/${detail.applicationId}`} body={{ action: "schedule-interview" }} label="Schedule interview" variant="outline" />
          <OpsActionButton method="PATCH" url={`/api/ops/applications/${detail.applicationId}`} body={{ action: "accept" }} label="Accept" variant="accent" />
          <OpsActionButton method="PATCH" url={`/api/ops/applications/${detail.applicationId}`} body={{ action: "decline" }} label="Decline" variant="outline" confirmText="Decline this application?" />
        </div>
      </div>
    </div>
  );
}
