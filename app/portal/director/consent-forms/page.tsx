import Link from "next/link";
import { getConsentFormsForDirector } from "@/lib/portal/director/consent-forms-data";
import SampleBanner from "@/components/portal/SampleBanner";
import ConsentFormsBrowser from "@/components/portal/director/ConsentFormsBrowser";
import { requireDirector } from "@/lib/portal/director/guard";

export default async function ConsentFormsPage() {
  // Gate first: nothing below this line runs for a non-director (see guard.ts).
  await requireDirector();
  const { forms, isSample } = await getConsentFormsForDirector();
  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Consent forms</h1>
          <p className="text-ink/60 text-sm mt-1">
            The consent and acknowledgment forms your chapter uses, grouped by audience. View each form&apos;s document, checkbox items and detail fields, or edit and publish your own versions.
          </p>
        </div>
        <Link
          href="/portal/director/consent-forms/new"
          className="shrink-0 rounded-lg px-3.5 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: "var(--pt-accent)" }}
        >
          New consent form
        </Link>
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
