import Link from "next/link";
import { getEditableConsentForm } from "@/lib/portal/director/consent-forms-data";
import SampleBanner from "@/components/portal/SampleBanner";
import ConsentFormEditor from "@/components/portal/director/ConsentFormEditor";

export default async function ConsentFormEditPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const { editable, isSample } = await getEditableConsentForm(key);
  if (!editable) {
    return <p className="text-sm text-ink/50">Consent form not found.</p>;
  }
  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <Link
        href={`/portal/director/consent-forms/${key}`}
        className="text-xs font-semibold"
        style={{ color: "var(--pt-accent)" }}
      >
        ← Back to form
      </Link>
      <div>
        <h1 className="text-2xl font-bold">Edit consent form</h1>
        <p className="text-ink/60 text-sm mt-1">
          Reword the checkbox items, curate the detail fields, and replace the document. Save a draft to keep working, or
          publish to make it your chapter&apos;s live version.
        </p>
      </div>
      {isSample && <SampleBanner />}
      <ConsentFormEditor initial={editable} mode="edit" />
    </div>
  );
}
