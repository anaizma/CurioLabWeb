"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { TermOption } from "@/lib/portal/director/applications-data";

/**
 * Term filter for the applications list. Client-side so the native <select> can
 * navigate. (The Partial/Full view toggle was removed - the list is always full.)
 */
export default function ApplicationsControls({
  terms,
  activeTermId,
}: {
  terms: TermOption[];
  activeTermId: string | null;
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
    </div>
  );
}
