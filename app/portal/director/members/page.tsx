import { getMembersView, type MemberStatus } from "@/lib/portal/director/members-data";
import SampleBanner from "@/components/portal/SampleBanner";
import OpsActionButton from "@/components/portal/director/OpsActionButton";

const STATUS_BG: Record<MemberStatus, string> = {
  active: "#e7f2ea",
  pending: "var(--pt-accent-soft)",
  suspended: "#f6e2e2",
  lapsed: "#eef0f2",
};

export default async function MembersPage() {
  const { members, isSample } = await getMembersView();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Members</h1>
        <p className="text-ink/60 text-sm mt-1">Chapter roster — activate pending memberships and review tiers and pods.</p>
      </div>
      {isSample && <SampleBanner />}
      <div className="rounded-xl border border-ink/10 bg-white divide-y divide-ink/5">
        {members.map((m) => (
          <div key={m.membershipId} className="px-4 py-3 flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">
                {m.displayName} <span className="text-ink/40 font-normal text-xs">· {m.role}</span>
              </div>
              <div className="text-xs text-ink/50">Tier: {m.tier} · Pod: {m.podName}</div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-[11px] font-semibold rounded-full px-2 py-0.5" style={{ background: STATUS_BG[m.status], color: "#44515f" }}>
                {m.status}
              </span>
              {m.status === "pending" &&
                (isSample ? (
                  <button type="button" disabled className="rounded-lg px-3 py-1.5 text-xs font-semibold border border-ink/15 text-ink/40 disabled:opacity-60">
                    Activate
                  </button>
                ) : (
                  <OpsActionButton method="POST" url={`/api/ops/memberships/${m.membershipId}/activate`} label="Activate" variant="accent" />
                ))}
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-ink/40">Activation connects to POST /api/ops/memberships/&#123;id&#125;/activate once GET /api/ops/memberships supplies live rows.</p>
    </div>
  );
}
