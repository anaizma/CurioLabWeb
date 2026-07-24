import { getDashboardSummary } from "@/lib/portal/director/dashboard-data";
import SampleBanner from "@/components/portal/SampleBanner";

export default async function DirectorDashboardPage() {
  const s = await getDashboardSummary();
  const cards = [
    { label: "New applications", value: s.newApplications, href: "/portal/director/applications" },
    { label: "Pending invites", value: s.pendingInvites, href: "/portal/director/invites" },
    { label: "Guardianships to verify", value: s.guardianshipsToVerify, href: "/portal/director/guardianships" },
    { label: "Media to review", value: s.mediaToReview, href: "/portal/director/media" },
    { label: "Open requests", value: s.openRequests, href: "/portal/director/requests" },
    { label: "Active members", value: s.activeMembers, href: "/portal/director/members" },
  ];
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Chapter dashboard</h1>
        <p className="text-ink/60 text-sm mt-1">Everything waiting on you across intake, roster, and safety.</p>
      </div>
      {s.isSample && <SampleBanner />}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {cards.map((c) => (
          <a
            key={c.href}
            href={c.href}
            className="rounded-xl border border-ink/10 bg-white p-5 hover:border-ink/20 transition-colors"
          >
            <div className="text-3xl font-bold" style={{ color: "var(--pt-accent)" }}>
              {c.value}
            </div>
            <div className="text-sm text-ink/60 mt-1">{c.label}</div>
          </a>
        ))}
      </div>
    </div>
  );
}
