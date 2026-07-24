import Link from "next/link";
import { getGuardianView } from "@/lib/portal/guardian/guardian-data";
import SampleBanner from "@/components/portal/SampleBanner";
import NominationCard from "@/components/portal/guardian/NominationCard";

export default async function GuardianHomePage() {
  const v = await getGuardianView();
  const needsForm = v.grants.filter((g) => g.status === "needs_form").length;
  const expiring = v.grants.filter((g) => g.status === "expiring");
  const active = v.grants.filter((g) => g.status === "granted" || g.status === "expiring").length;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Welcome</h1>
        <p className="text-ink/60 text-sm mt-1">Everything for {v.child.displayName} in one place.</p>
      </div>
      {v.isSample && <SampleBanner />}

      <div className="rounded-xl border border-ink/10 bg-white p-5">
        <div className="text-sm font-semibold">{v.child.displayName}</div>
        <div className="text-xs text-ink/50 mt-0.5">{v.child.ageBand} · {v.child.chapterName}</div>
        <div className="text-xs text-ink/60 mt-2">
          {active} of {v.grants.length} consents active{needsForm > 0 ? ` · ${needsForm} needs a signed form` : ""}.{" "}
          <Link href="/portal/parent/consent" className="font-semibold" style={{ color: "var(--pt-accent)" }}>
            Review consent →
          </Link>
        </div>
      </div>

      {(v.nominations.length > 0 || expiring.length > 0) && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-bold text-ink/70">Needs your attention</h2>
          {v.nominations.map((n) => (
            <NominationCard key={n.id} nomination={n} childName={v.child.displayName} />
          ))}
          {expiring.map((g) => (
            <div key={g.grantType} className="rounded-xl border border-ink/10 bg-white p-4 text-sm flex items-center justify-between gap-3">
              <span>
                <span className="font-medium">{g.label}</span> — {g.expiresLabel.toLowerCase()}.
              </span>
              <Link href="/portal/parent/consent" className="text-xs font-semibold shrink-0" style={{ color: "var(--pt-accent)" }}>
                Renew
              </Link>
            </div>
          ))}
        </div>
      )}

      <div>
        <Link href="/portal/parent/activity" className="text-sm font-semibold" style={{ color: "var(--pt-accent)" }}>
          See what {v.child.displayName} has shared publicly →
        </Link>
      </div>
    </div>
  );
}
