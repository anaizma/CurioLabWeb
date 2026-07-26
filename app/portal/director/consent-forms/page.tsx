import { getConsentFormsForDirector } from "@/lib/portal/director/consent-forms-data";
import SampleBanner from "@/components/portal/SampleBanner";
import ConsentFormsBrowser from "@/components/portal/director/ConsentFormsBrowser";

export default async function ConsentFormsPage() {
  const { forms, isSample } = await getConsentFormsForDirector();
  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Consent forms</h1>
        <p className="text-ink/60 text-sm mt-1">
          The consent and acknowledgment forms your chapter uses, grouped by audience. View each form&apos;s document, checkbox items and detail fields. Read-only.
        </p>
      </div>
      {isSample && <SampleBanner />}
      {forms.length === 0 ? (
        <p className="text-sm text-ink/50">No consent forms in the catalog.</p>
      ) : (
        <ConsentFormsBrowser forms={forms} />
      )}
    </div>
  );
}
