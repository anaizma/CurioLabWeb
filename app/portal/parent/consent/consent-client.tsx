"use client";

import { useState } from "react";
import type { ConsentGrant, GrantStatus } from "@/lib/portal/guardian/types";

const STATUS: Record<GrantStatus, { label: string; bg: string; fg: string; bd: string }> = {
  granted: { label: "Granted", bg: "#e7f2ea", fg: "#2f7a4d", bd: "#cfe6d6" },
  needs_form: { label: "Needs signed form", bg: "var(--pt-accent-soft)", fg: "var(--pt-accent-fg)", bd: "var(--pt-accent-border)" },
  pending: { label: "Pending", bg: "#eef0f2", fg: "#556", bd: "#dfe3e8" },
  expiring: { label: "Expiring soon", bg: "#fcf1d6", fg: "#8a5b00", bd: "#f0dfae" },
  revoked: { label: "Revoked", bg: "#eef0f2", fg: "#556", bd: "#dfe3e8" },
};

export default function ConsentClient({ grants }: { grants: ConsentGrant[] }) {
  const [revoked, setRevoked] = useState<Record<string, boolean>>({});
  const [uploaded, setUploaded] = useState<Record<string, boolean>>({});

  return (
    <div className="bg-white border border-black/[.08] rounded-lg divide-y divide-black/[.05]">
      {grants.map((g) => {
        const isRevoked = revoked[g.grantType];
        const isUploaded = uploaded[g.grantType];
        const status: GrantStatus = isRevoked ? "revoked" : isUploaded ? "granted" : g.status;
        const s = STATUS[status];
        return (
          <div key={g.grantType} className="p-3.5 flex flex-col gap-1.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13.5px] font-semibold">{g.label}</div>
                <p className="text-[12px] text-muted mt-0.5 leading-relaxed">{g.description}</p>
              </div>
              <span className="font-mono text-[9.5px] uppercase tracking-wider rounded-full px-2 py-0.5 shrink-0 border" style={{ background: s.bg, color: s.fg, borderColor: s.bd }}>{s.label}</span>
            </div>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="font-mono text-[10.5px] text-muted">
                {g.method === "signed_form" ? "Signed form" : "Click to agree"} · {g.renewalLabel} · {isRevoked ? "Withdrawn" : isUploaded && g.grantType === "public_publication" ? "On file" : g.expiresLabel}
              </span>
              <div className="flex items-center gap-2">
                {g.status === "needs_form" && !isUploaded && !isRevoked && (
                  <button type="button" onClick={() => setUploaded((u) => ({ ...u, [g.grantType]: true }))} className="rounded-md px-2.5 py-1 text-[11.5px] font-semibold" style={{ background: "var(--pt-accent)", color: "var(--pt-on-accent)" }}>Upload signed form</button>
                )}
                {g.revocable && !isRevoked && !(g.status === "needs_form" && !isUploaded) && (
                  <button type="button" onClick={() => setRevoked((r) => ({ ...r, [g.grantType]: true }))} className="rounded-md px-2.5 py-1 text-[11.5px] font-semibold border border-black/15 text-muted hover:text-ink">Withdraw</button>
                )}
                {g.revocable && isRevoked && (
                  <button type="button" onClick={() => setRevoked((r) => ({ ...r, [g.grantType]: false }))} className="text-[11.5px] font-semibold" style={{ color: "var(--pt-accent)" }}>Restore</button>
                )}
                {!g.revocable && <span className="font-mono text-[10px] uppercase text-muted/70">Required</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
