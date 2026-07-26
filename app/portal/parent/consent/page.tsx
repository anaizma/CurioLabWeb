import { getGuardianView } from '@/lib/portal/guardian/guardian-data'
import { getChildForms } from '@/lib/portal/guardian/consent-forms'
import NominationCard from '@/components/portal/guardian/NominationCard'
import ConsentClient from './consent-client'

export default async function GuardianConsentPage() {
  const v = await getGuardianView()
  const forms = await getChildForms(v.child.id)
  return (
    <div className="mx-auto max-w-3xl px-5 py-5 flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Consent for {v.child.displayName}</h1>
        <p className="text-muted text-[13px] mt-1">Read each form and record your choices. Each item is a separate, dated grant you can withdraw later.</p>
      </div>
      {v.isSample && <div className="text-[11px] font-mono text-muted border border-dashed border-black/15 rounded-md px-3 py-2">Sample data — sign in as a guardian to complete real forms.</div>}
      {v.nominations.map((n) => <NominationCard key={n.id} nomination={n} childName={v.child.displayName} />)}
      <ConsentClient forms={forms ?? []} />
    </div>
  )
}
