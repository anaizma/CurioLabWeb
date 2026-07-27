import { getGuardianshipsView } from "@/lib/portal/director/guardianships-data";
import SampleBanner from "@/components/portal/SampleBanner";
import OpsActionButton from "@/components/portal/director/OpsActionButton";
import { requireDirector } from "@/lib/portal/director/guard";

export default async function GuardianshipsPage() {
  // Gate first: nothing below this line runs for a non-director (see guard.ts).
  await requireDirector();
  const { guardianships, isSample } = await getGuardianshipsView();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Guardianships</h1>
        <p className="text-ink/60 text-sm mt-1">Verify that the name on the account matches the name on the signed form before granting access.</p>
      </div>
      {isSample && <SampleBanner />}
      <div className="flex flex-col gap-3">
        {guardianships.map((g) => {
          const match = g.guardianName.trim().toLowerCase() === g.nameOnForm.trim().toLowerCase();
          return (
            <div key={g.guardianshipId} className="rounded-sm border border-ink/10 bg-white p-4 flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-medium">Guardian of {g.studentName}</div>
                <div className="text-xs text-ink/50 mt-1">On account: {g.guardianName}</div>
                <div className="text-xs text-ink/50">On form: {g.nameOnForm}</div>
                {g.status === "pending" && (
                  <div className="text-[11px] mt-1" style={{ color: match ? "#2f7a4d" : "var(--pt-accent-fg)" }}>
                    {match ? "Names match" : "Names differ — check carefully"}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <span className="text-[11px] font-semibold rounded-full px-2 py-0.5" style={{ background: "var(--pt-accent-soft)", color: "var(--pt-accent-fg)" }}>
                  {g.status}
                </span>
                {g.status === "pending" &&
                  (isSample ? (
                    <div className="flex gap-2">
                      <button type="button" disabled className="rounded-lg px-3 py-1.5 text-xs font-semibold border border-ink/15 text-ink/40 disabled:opacity-60">Verify</button>
                      <button type="button" disabled className="rounded-lg px-3 py-1.5 text-xs font-semibold border border-ink/15 text-ink/40 disabled:opacity-60">Revoke</button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <OpsActionButton method="POST" url={`/api/ops/guardianships/${g.guardianshipId}/verify`} label="Verify" variant="accent" />
                      <OpsActionButton method="POST" url={`/api/ops/guardianships/${g.guardianshipId}/revoke`} label="Revoke" variant="outline" confirmText="Revoke this guardianship?" />
                    </div>
                  ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-ink/40">Verify/revoke connect to POST /api/ops/guardianships/&#123;id&#125;/verify|revoke once GET /api/ops/guardianships supplies live rows.</p>
    </div>
  );
}
