import { getEnrollmentsView } from "@/lib/portal/director/enrollments-data";
import SampleBanner from "@/components/portal/SampleBanner";
import { requireDirector } from "@/lib/portal/director/guard";

export default async function EnrollmentsPage() {
  // Gate first: nothing below this line runs for a non-director (see guard.ts).
  await requireDirector();
  const { enrollments, isSample } = await getEnrollmentsView();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Enrollments</h1>
        <p className="text-ink/60 text-sm mt-1">Signed enrollment records for accepted applicants.</p>
      </div>
      {isSample && <SampleBanner />}
      <div className="rounded-sm border border-ink/10 bg-white divide-y divide-ink/5">
        {enrollments.map((e) => (
          <div key={e.enrollmentRecordId} className="px-4 py-3 flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">
                {e.studentName} <span className="text-ink/40 font-normal text-xs">· {e.termName}</span>
              </div>
              <div className="text-xs text-ink/50">Signed by {e.guardianNameOnForm} on {e.signatureLabel}</div>
            </div>
            <span className="text-[11px] font-semibold rounded-full px-2 py-0.5" style={{ background: e.hasAccount ? "#e7f2ea" : "var(--pt-accent-soft)", color: "#44515f" }}>
              {e.hasAccount ? "Account created" : "Awaiting account"}
            </span>
          </div>
        ))}
      </div>
      <p className="text-xs text-ink/40">Wires to GET /api/ops/enrollments when available.</p>
    </div>
  );
}
