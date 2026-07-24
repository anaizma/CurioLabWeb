import { getGuardianView } from "@/lib/portal/guardian/guardian-data";
import NominationCard from "@/components/portal/guardian/NominationCard";
import ConsentClient from "./consent-client";

export default async function GuardianConsentPage() {
  const v = await getGuardianView();
  const active = v.grants.filter((g) => g.status === "granted" || g.status === "expiring").length;
  return (
    <div className="mx-auto max-w-3xl px-5 py-5 flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Consent for {v.child.displayName}</h1>
        <p className="text-muted text-[13px] mt-1">Each item is a separate grant — you can withdraw one without leaving the program. <span className="font-mono">{active}/{v.grants.length}</span> active.</p>
      </div>
      {v.isSample && (
        <div className="text-[11px] font-mono text-muted border border-dashed border-black/15 rounded-md px-3 py-2">Sample data — sign in as a guardian to manage real consent.</div>
      )}
      {v.nominations.map((n) => (
        <NominationCard key={n.id} nomination={n} childName={v.child.displayName} />
      ))}
      <ConsentClient grants={v.grants} />
      <p className="text-[11px] text-muted">Each grant is an independent, dated record with its own renewal clock and revocation — never one bundled signature.</p>
    </div>
  );
}
