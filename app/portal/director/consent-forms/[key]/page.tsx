import Link from "next/link";
import { getConsentFormDetailForDirector, AUDIENCE_LABELS } from "@/lib/portal/director/consent-forms-data";
import SampleBanner from "@/components/portal/SampleBanner";
import FormViewer from "@/components/portal/guardian/FormViewer";
import { requireDirector } from "@/lib/portal/director/guard";

export default async function ConsentFormDetailPage({ params }: { params: Promise<{ key: string }> }) {
  // Gate first: nothing below this line runs for a non-director (see guard.ts).
  await requireDirector();
  const { key } = await params;
  const { detail, isSample } = await getConsentFormDetailForDirector(key);
  if (!detail) {
    return <p className="text-sm text-ink/50">Consent form not found.</p>;
  }
  return (
    <div className="flex flex-col gap-6">
      <Link href="/portal/director/consent-forms" className="text-xs font-semibold" style={{ color: "var(--pt-accent)" }}>
        ← All consent forms
      </Link>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold">{detail.title}</h1>
            {detail.elevated && (
              <span
                className="text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5"
                style={{ background: "var(--pt-accent-soft)", color: "var(--pt-accent-fg)" }}
              >
                Elevated
              </span>
            )}
          </div>
          <p className="text-ink/60 text-sm mt-1 font-mono">
            {AUDIENCE_LABELS[detail.audience]} · {detail.documentId} · v{detail.version}
          </p>
        </div>
        <Link
          href={`/portal/director/consent-forms/${detail.formKey}/edit`}
          className="shrink-0 rounded-lg px-3.5 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: "var(--pt-accent)" }}
        >
          Edit
        </Link>
      </div>
      {isSample && <SampleBanner />}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* PDF document */}
        <div className="flex flex-col gap-2">
          <div className="label text-[10.5px] text-ink/40">Document</div>
          <FormViewer src={detail.pdfPath} />
        </div>

        {/* Items + fields */}
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <div className="label text-[10.5px] text-ink/40">
              Checkbox items ({detail.items.length})
            </div>
            {detail.items.length === 0 ? (
              <p className="text-sm text-ink/50">No checkbox items.</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {detail.items.map((it) => (
                  <li key={it.itemKey} className="rounded-sm border border-ink/10 bg-white p-3 flex flex-col gap-1.5">
                    <p className="text-sm">{it.text}</p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className="text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 bg-ink/5 text-ink/60"
                      >
                        {it.required ? "Required" : "Optional"}
                      </span>
                      {it.elevated && (
                        <span
                          className="text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5"
                          style={{ background: "var(--pt-accent-soft)", color: "var(--pt-accent-fg)" }}
                        >
                          Elevated
                        </span>
                      )}
                      {it.grantMapping && (
                        <span className="text-[10px] font-mono rounded px-1.5 py-0.5 bg-ink/5 text-ink/60">
                          grants: {it.grantMapping}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <div className="label text-[10.5px] text-ink/40">
              Detail fields ({detail.fields.length})
            </div>
            {detail.fields.length === 0 ? (
              <p className="text-sm text-ink/50">No detail fields.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {detail.fields.map((f) => (
                  <li key={f.fieldType} className="rounded-sm border border-ink/10 bg-white p-3 flex items-center justify-between gap-3">
                    <span className="text-sm">{f.label}</span>
                    <span className="text-[11px] text-ink/50 font-mono shrink-0">
                      {f.inputType}
                      {f.required ? " · required" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
