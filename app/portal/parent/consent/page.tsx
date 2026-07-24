import { getGuardianView } from "@/lib/portal/guardian/guardian-data";
import SampleBanner from "@/components/portal/SampleBanner";
import ConsentClient from "./consent-client";
import NominationCard from "@/components/portal/guardian/NominationCard";

export default async function GuardianConsentPage() {
  const v = await getGuardianView();
  const active = v.grants.filter((g) => g.status === "granted" || g.status === "expiring").length;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Consent for {v.child.displayName}</h1>
        <p className="text-ink/60 text-sm mt-1">
          Each item is separate — you can withdraw one without leaving the program. {active} of {v.grants.length} active.
        </p>
      </div>
      {v.isSample && <SampleBanner />}
      {v.nominations.map((n) => (
        <NominationCard key={n.id} nomination={n} childName={v.child.displayName} />
      ))}
      <ConsentClient grants={v.grants} />
    </div>
  );
}
