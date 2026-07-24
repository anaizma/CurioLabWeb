"use client";

import { useState } from "react";
import type { InviteRow } from "@/lib/portal/director/types";

type Kind = "guardian" | "mentor" | "staff";
const KIND_LABEL: Record<InviteRow["kind"], string> = { guardian: "Guardian", mentor: "Mentor", staff: "Staff", director: "Director", admin: "Admin" };
const inputCls = "w-full rounded-lg border border-ink/15 px-3 py-2 text-sm bg-white";

export default function InvitesClient({ chapterId, invites, isSample }: { chapterId: string | null; invites: InviteRow[]; isSample: boolean }) {
  const [kind, setKind] = useState<Kind>("guardian");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ token: string; expiresAt: string; emailed: boolean; sentTo: string } | null>(null);
  const [resent, setResent] = useState<Record<string, { token: string; expiresAt: string }>>({});

  const canIssue = chapterId !== null;
  const linkFor = (token: string) => `${typeof window !== "undefined" ? window.location.origin : ""}/invite/${token}`;

  async function issue(e: React.FormEvent) {
    e.preventDefault();
    if (!chapterId) return;
    const sentTo = email.trim();
    setBusy(true);
    setError(null);
    setIssued(null);
    try {
      const res = await fetch("/api/director/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, chapterId, targetEmail: sentTo || undefined }),
      });
      if (!res.ok) {
        setError(res.status === 403 ? "You don't have permission to issue invites." : "Could not issue the invite.");
        return;
      }
      const data = (await res.json()) as { token: string; expiresAt: string; emailed?: boolean };
      setIssued({ token: data.token, expiresAt: data.expiresAt, emailed: Boolean(data.emailed), sentTo });
      setEmail("");
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function resend(inv: InviteRow) {
    if (isSample) return;
    setError(null);
    try {
      const res = await fetch("/api/director/invites/resend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inviteId: inv.inviteId, targetEmail: inv.targetEmail ?? undefined, kind: inv.kind }),
      });
      if (!res.ok) {
        setError(res.status === 404 ? "That invite no longer exists." : "Could not resend the invite.");
        return;
      }
      const data = (await res.json()) as { token: string; expiresAt: string };
      setResent((r) => ({ ...r, [inv.inviteId]: { token: data.token, expiresAt: data.expiresAt } }));
    } catch {
      setError("Network error — please try again.");
    }
  }

  return (
    <div className="grid md:grid-cols-2 gap-8">
      <form onSubmit={issue} className="rounded-2xl border border-ink/10 bg-white p-6 flex flex-col gap-4">
        <h2 className="font-bold">Issue an invite</h2>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/60">Role</span>
          <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="guardian">Guardian</option>
            <option value="mentor">Mentor</option>
            <option value="staff">Staff</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/60">Email (optional)</span>
          <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.org" />
        </label>
        <button
          type="submit"
          disabled={!canIssue || busy}
          className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          style={{ background: "var(--pt-accent)", color: "var(--pt-on-accent)" }}
        >
          {busy ? "Issuing…" : "Create invite link"}
        </button>
        {!canIssue && <p className="text-xs text-ink/50">Sign in as a Chapter Director to issue live invites.</p>}
        {error && <p className="text-xs" style={{ color: "var(--pt-accent-fg)" }}>{error}</p>}
        {issued && (
          <div className="rounded-lg border border-ink/10 bg-cream p-3 text-sm flex flex-col gap-2">
            <span className="text-ink/60 text-xs">Shareable link (shown once) · expires {new Date(issued.expiresAt).toLocaleDateString()}</span>
            {issued.emailed && <span className="text-xs font-medium" style={{ color: "var(--pt-accent-fg)" }}>Emailed to {issued.sentTo}</span>}
            <code className="text-xs break-all">{linkFor(issued.token)}</code>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(linkFor(issued.token))}
              className="self-start text-xs font-semibold"
              style={{ color: "var(--pt-accent)" }}
            >
              Copy link
            </button>
          </div>
        )}
      </form>

      <div className="rounded-2xl border border-ink/10 bg-white p-6">
        <h2 className="font-bold mb-3">Recent invites</h2>
        <ul className="flex flex-col divide-y divide-ink/5">
          {invites.map((inv) => {
            const fresh = resent[inv.inviteId];
            return (
              <li key={inv.inviteId} className="py-3 flex items-start justify-between gap-3 text-sm">
                <div>
                  <div className="font-medium">
                    {KIND_LABEL[inv.kind]}
                    <span className="text-ink/50 font-normal"> · {inv.targetEmail ?? "no email"}</span>
                  </div>
                  <div className="text-xs text-ink/50">
                    {inv.status} · issued {inv.issuedLabel} · expires {inv.expiresLabel}
                  </div>
                  {fresh && <code className="text-[11px] break-all text-ink/60">{linkFor(fresh.token)}</code>}
                </div>
                {inv.status === "pending" && (
                  <button type="button" onClick={() => resend(inv)} disabled={isSample} className="text-xs font-semibold shrink-0 disabled:opacity-40" style={{ color: "var(--pt-accent)" }}>
                    Resend
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
