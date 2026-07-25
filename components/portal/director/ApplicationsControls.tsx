"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { TermOption } from "@/lib/portal/director/applications-data";

/**
 * Term filter + Partial/Full view toggle for the applications list. Client-side so the
 * native <select> can navigate; each control preserves the other's query param.
 */
export default function ApplicationsControls({
  terms,
  activeTermId,
  view,
}: {
  terms: TermOption[];
  activeTermId: string | null;
  view: "partial" | "full";
}) {
  const router = useRouter();
  const params = useSearchParams();

  // With no explicit ?term, the backend defaults to the most-recent term (activeTermId).
  const selectedTerm = params.get("term") ?? activeTermId ?? "all";

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value === null) next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    router.push(qs ? `/portal/director/applications?${qs}` : "/portal/director/applications");
  }

  const activePill = { background: "var(--pt-accent-soft)", color: "var(--pt-accent-fg)" };
  const idlePill = { color: "var(--color-ink)", opacity: 0.6 };

  return (
    <div className="flex items-center gap-2 flex-wrap shrink-0">
      <select
        value={selectedTerm}
        onChange={(e) => setParam("term", e.target.value)}
        aria-label="Filter by term"
        className="rounded-lg border border-ink/10 bg-white px-2.5 py-1.5 text-xs font-semibold text-ink/70 focus:outline-none focus:ring-2"
        style={{ ["--tw-ring-color" as string]: "var(--pt-accent-soft)" }}
      >
        {terms.map((t) => (
          <option key={t.termId} value={t.termId}>{t.name}</option>
        ))}
        <option value="all">All terms</option>
      </select>

      <div className="flex items-center gap-1 rounded-lg border border-ink/10 bg-white p-0.5 text-xs font-semibold">
        <button type="button" onClick={() => setParam("view", null)} className="rounded-md px-2.5 py-1 transition-colors" style={view === "partial" ? activePill : idlePill}>
          Partial
        </button>
        <button type="button" onClick={() => setParam("view", "full")} className="rounded-md px-2.5 py-1 transition-colors" style={view === "full" ? activePill : idlePill}>
          Full view
        </button>
      </div>
    </div>
  );
}
