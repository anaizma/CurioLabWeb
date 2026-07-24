"use client";

import { useState } from "react";
import type { ConsentGrant, GrantStatus } from "@/lib/portal/guardian/types";

const STATUS_LABEL: Record<GrantStatus, string> = {
  granted: "Granted",
  needs_form: "Needs signed form",
  pending: "Pending",
  expiring: "Expiring soon",
  revoked: "Revoked",
};

export default function ConsentClient({ grants }: { grants: ConsentGrant[] }) {
  const [revoked, setRevoked] = useState<Record<string, boolean>>({});
  const [uploaded, setUploaded] = useState<Record<string, boolean>>({});

  return (
    <div className="flex flex-col gap-3">
      {grants.map((g) => {
        const isRevoked = revoked[g.grantType];
        const isUploaded = uploaded[g.grantType];
        const effectiveStatus: GrantStatus = isRevoked ? "revoked" : isUploaded ? "granted" : g.status;
        return (
          <div key={g.grantType} className="rounded-xl border border-ink/10 bg-white p-4 flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">{g.label}</div>
                <p className="text-xs text-ink/60 mt-0.5 max-w-prose">{g.description}</p>
              </div>
              <span
                className="text-[11px] font-semibold rounded-full px-2 py-0.5 shrink-0"
                style={{ background: "var(--pt-accent-soft)", color: "var(--pt-accent-fg)" }}
              >
                {STATUS_LABEL[effectiveStatus]}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 text-[11px] text-ink/50">
              <span>
                {g.method === "signed_form" ? "Signed form" : "Click to agree"} · {g.renewalLabel} ·{" "}
                {isRevoked ? "Withdrawn" : g.expiresLabel}
              </span>
              <div className="flex items-center gap-2">
                {g.status === "needs_form" && !isUploaded && !isRevoked && (
                  <button
                    type="button"
                    onClick={() => setUploaded((u) => ({ ...u, [g.grantType]: true }))}
                    className="rounded-lg px-3 py-1.5 font-semibold"
                    style={{ background: "var(--pt-accent)", color: "var(--pt-on-accent)" }}
                  >
                    Upload signed form
                  </button>
                )}
                {g.revocable && !isRevoked && g.status !== "needs_form" && (
                  <button
                    type="button"
                    onClick={() => setRevoked((r) => ({ ...r, [g.grantType]: true }))}
                    className="rounded-lg px-3 py-1.5 font-semibold border border-ink/15 text-ink/60"
                  >
                    Withdraw
                  </button>
                )}
                {g.revocable && isRevoked && (
                  <button
                    type="button"
                    onClick={() => setRevoked((r) => ({ ...r, [g.grantType]: false }))}
                    className="rounded-lg px-3 py-1.5 font-semibold"
                    style={{ color: "var(--pt-accent)" }}
                  >
                    Restore
                  </button>
                )}
                {!g.revocable && <span className="text-ink/40">Required</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
