import Link from "next/link";
import { emptyEditableFor } from "@/lib/portal/director/consent-forms-data";
import ConsentFormEditor from "@/components/portal/director/ConsentFormEditor";
import { requireDirector } from "@/lib/portal/director/guard";

export default async function NewConsentFormPage() {
  // Gate first: nothing below this line runs for a non-director (see guard.ts).
  await requireDirector();
  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <Link
        href="/portal/director/consent-forms"
        className="text-xs font-semibold"
        style={{ color: "var(--pt-accent)" }}
      >
        ← All consent forms
      </Link>
      <div>
        <h1 className="text-2xl font-bold">New consent form</h1>
        <p className="text-ink/60 text-sm mt-1">
          Build a new consent or acknowledgment form for your chapter. Pick the audience, upload the document, and add the
          checkbox items and detail fields. A PDF is required.
        </p>
      </div>
      <ConsentFormEditor initial={emptyEditableFor("guardian")} mode="create" />
    </div>
  );
}
