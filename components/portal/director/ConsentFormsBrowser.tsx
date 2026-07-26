"use client";

import { useState } from "react";
import Link from "next/link";
// Type-only import: the data module depends on next/headers (server-only), so the
// client bundle must not pull its runtime values. The audience constants are
// defined locally below.
import type { DirectorFormSummary, FormAudience } from "@/lib/portal/director/consent-forms-data";

const AUDIENCES: FormAudience[] = ["guardian", "mentor", "student"];
const AUDIENCE_LABELS: Record<FormAudience, string> = {
  guardian: "Guardian",
  mentor: "Mentor",
  student: "Student",
};

/**
 * Read-only browser for the consent-form catalog: an audience switcher
 * (guardian / mentor / student) filtering the list, each form linking to its
 * detail page. Client-side so the tabs toggle without a round-trip; defaults to
 * the guardian audience.
 */
export default function ConsentFormsBrowser({ forms }: { forms: DirectorFormSummary[] }) {
  const [audience, setAudience] = useState<FormAudience>("guardian");
  const visible = forms.filter((f) => f.audience === audience);

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Form audience" className="flex gap-1 border-b border-ink/10">
        {AUDIENCES.map((a) => {
          const active = a === audience;
          const count = forms.filter((f) => f.audience === a).length;
          return (
            <button
              key={a}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setAudience(a)}
              className="px-3 py-2 text-sm font-semibold -mb-px border-b-2 transition-colors"
              style={
                active
                  ? { color: "var(--pt-accent-fg)", borderColor: "var(--pt-accent)" }
                  : { color: "var(--pt-ink, inherit)", borderColor: "transparent", opacity: 0.55 }
              }
            >
              {AUDIENCE_LABELS[a]} <span className="text-xs font-normal">({count})</span>
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-ink/50">No {AUDIENCE_LABELS[audience].toLowerCase()} forms.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((f) => (
            <Link
              key={f.formKey}
              href={`/portal/director/consent-forms/${f.formKey}`}
              className="rounded-sm border border-ink/10 bg-white p-4 flex flex-col gap-1.5 hover:border-ink/25 transition-colors"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold">{f.title}</span>
                {f.elevated && (
                  <span
                    className="text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5"
                    style={{ background: "var(--pt-accent-soft)", color: "var(--pt-accent-fg)" }}
                  >
                    Elevated
                  </span>
                )}
              </div>
              <div className="text-xs text-ink/50 font-mono">
                {f.documentId} · v{f.version}
              </div>
              <div className="text-xs text-ink/50">
                {f.itemCount} checkbox item{f.itemCount === 1 ? "" : "s"} · {f.fieldCount} detail field
                {f.fieldCount === 1 ? "" : "s"}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
