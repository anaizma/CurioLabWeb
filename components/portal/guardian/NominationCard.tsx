"use client";

import { useState } from "react";
import type { Nomination } from "@/lib/portal/guardian/types";

export default function NominationCard({ nomination, childName }: { nomination: Nomination; childName: string }) {
  const [objected, setObjected] = useState(false);
  return (
    <div
      className="rounded-xl border p-4 flex items-start justify-between gap-4"
      style={{ borderColor: "var(--pt-accent-border)", background: "var(--pt-accent-soft)" }}
    >
      <div>
        <div className="text-sm font-medium">
          {childName}&apos;s work “{nomination.itemTitle}” is nominated for the {nomination.surfaceLabel}.
        </div>
        <div className="text-xs mt-1" style={{ color: "var(--pt-accent-fg)" }}>
          {objected ? "Objected — this will be withheld." : `Publishes in ${nomination.publishesInLabel} unless you object.`}
        </div>
      </div>
      {!objected && (
        <button
          type="button"
          onClick={() => setObjected(true)}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold shrink-0"
          style={{ background: "var(--pt-accent)", color: "var(--pt-on-accent)" }}
        >
          Object
        </button>
      )}
    </div>
  );
}
