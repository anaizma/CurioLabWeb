"use client";

import { useState } from "react";
import type { InviteRow } from "@/lib/portal/director/types";

type IssueKind = "guardian" | "mentor" | "staff" | "director" | "admin";
const KIND_LABEL: Record<InviteRow["kind"], string> = { guardian: "Guardian", mentor: "Mentor", staff: "Staff", director: "Director", admin: "Admin" };
const inputCls = "w-full rounded-lg border border-ink/15 px-3 py-2 text-sm bg-white";

export default function InvitesClient({ chapterId, invites, isSample }: { chapterId: string | null; invites: InviteRow[]; isSample: boolean }) {
  const [kind, setKind] = useState<IssueKind>("guardian");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ token: string; expiresAt: string; emailed: boolean; sentTo: string } | null>(null);
  const [pending, setPending] = useState<{ requestId: string; expiresAt: string } | null>(null);
  const [resent, setResent] = useState<Record<string, { token: string; expiresAt: string }>>({});
  const [approveId, setApproveId] = useState("");
  const [approveBusy, setApproveBusy] = useState(false);
  const [approveErr, setApproveErr] = useState<string | null>(null);
  const [approved, setApproved] = useState<{ token: string; expiresAt: string } | null>(null);

  const canIssue = chapterId !== null;
  const linkFor = (token: string) => `${typeof window !== "undefined" ? window.location.origin : ""}/invite/${token}`;

  async function issue(e: React.FormEvent) {
    e.preventDefault();
    if (!chapterId) return;
    const sentTo = email.trim();
    setBusy(true);
    setError(null);
    setIssued(null);
    setPending(null);
    try {
      if (kind === "director") {
        const res = await fetch("/api/ops/invites/director-requests", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chapterId, targetEmail: sentTo }),
        });
        if (!res.ok) {
          setError(res.status === 403 ? "Only a Chapter Director can start a director invite." : res.status === 400 ? "A target email is required for a director invite." : "Could not start the request.");
          return;
        }
        const data = (await res.json()) as { requestId: string; expiresAt: string };
        setPending({ requestId: data.requestId, expiresAt: data.expiresAt });
        setEmail("");
        return;
      }
      const res = await fetch("/api/director/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, chapterId, targetEmail: sentTo || undefined }),
      });
      if (!res.ok) {
        setError(res.status === 403 ? (kind === "admin" ? "Only a platform admin can invite admins." : "You don't have permission to issue this invite.") : "Could not issue the invite.");
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

  async function approve(e: React.FormEvent) {
    e.preventDefault();
    const id = approveId.trim();
    if (!id) return;
    setApproveBusy(true);
    setApproveErr(null);
    setApproved(null);
    try {
      const res = await fetch(`/api/ops/invites/director-requests/${id}/approve`, { method: "POST" });
      if (!res.ok) {
        setApproveErr(res.status === 409 ? "You can't approve your own request, or it's already approved/expired." : res.status === 404 ? "No such request." : res.status === 403 ? "Only a Chapter Director can approve." : "Could not approve.");
        return;
      }
      const data = (await res.json()) as { token: string; expiresAt: string };
      setApproved({ token: data.token, expiresAt: data.expiresAt });
      setApproveId("");
    } catch {
      setApproveErr("Network error — please try again.");
    } finally {
      setApproveBusy(false);
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
    <div className="flex flex-col gap-8">
      <div className="grid md:grid-cols-2 gap-8">
        <form onSubmit={issue} className="rounded-sm border border-ink/10 bg-white p-6 flex flex-col gap-4">
          <h2 className="font-bold">Issue an invite</h2>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink/60">Role</span>
            <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as IssueKind)}>
              <option value="guardian">Guardian</option>
              <option value="mentor">Mentor</option>
              <option value="staff">Staff</option>
              <option value="director">Director (needs a second director)</option>
              <option value="admin">Admin (platform admin only)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink/60">Email{kind === "director" ? "" : " (optional)"}</span>
            <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.org" required={kind === "director"} />
          </label>
          <button type="submit" disabled={!canIssue || busy} className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50" style={{ background: "var(--pt-accent)", color: "var(--pt-on-accent)" }}>
            {busy ? "Working…" : kind === "director" ? "Start director request" : "Create invite link"}
          </button>
          {kind === "director" && <p className="text-xs text-ink/50">A second, different Chapter Director must approve this before the invite is created.</p>}
          {!canIssue && <p className="text-xs text-ink/50">Sign in as a Chapter Director to issue live invites.</p>}
          {error && <p className="text-xs" style={{ color: "var(--pt-accent-fg)" }}>{error}</p>}
          {pending && (
            <div className="rounded-sm border border-ink/10 bg-cream p-3 text-sm flex flex-col gap-1">
              <span className="text-ink/60 text-xs">Director request created · expires {new Date(pending.expiresAt).toLocaleDateString()}</span>
              <span className="text-xs">Give this request id to a second director to approve:</span>
              <code className="text-xs break-all font-semibold">{pending.requestId}</code>
            </div>
          )}
          {issued && (
            <div className="rounded-sm border border-ink/10 bg-cream p-3 text-sm flex flex-col gap-2">
              <span className="text-ink/60 text-xs">Shareable link (shown once) · expires {new Date(issued.expiresAt).toLocaleDateString()}</span>
              {issued.emailed && <span className="text-xs font-medium" style={{ color: "var(--pt-accent-fg)" }}>Emailed to {issued.sentTo}</span>}
              <code className="text-xs break-all">{linkFor(issued.token)}</code>
              <button type="button" onClick={() => navigator.clipboard?.writeText(linkFor(issued.token))} className="self-start text-xs font-semibold" style={{ color: "var(--pt-accent)" }}>Copy link</button>
            </div>
          )}
        </form>

        <div className="rounded-sm border border-ink/10 bg-white p-6">
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

      <form onSubmit={approve} className="rounded-sm border border-ink/10 bg-white p-6 flex flex-col gap-3 max-w-md">
        <h2 className="font-bold">Approve a director invite</h2>
        <p className="text-xs text-ink/50">A second director finishes a pending director request. You can&apos;t approve your own.</p>
        <div className="flex gap-2">
          <input className={inputCls} value={approveId} onChange={(e) => setApproveId(e.target.value)} placeholder="Request id" disabled={!canIssue} />
          <button type="submit" disabled={!canIssue || approveBusy || approveId.trim().length === 0} className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 shrink-0" style={{ background: "var(--pt-accent)", color: "var(--pt-on-accent)" }}>
            {approveBusy ? "…" : "Approve"}
          </button>
        </div>
        {approveErr && <p className="text-xs" style={{ color: "var(--pt-accent-fg)" }}>{approveErr}</p>}
        {approved && (
          <div className="rounded-lg border border-ink/10 bg-cream p-3 text-sm flex flex-col gap-2">
            <span className="text-ink/60 text-xs">Approved — director invite link (shown once) · expires {new Date(approved.expiresAt).toLocaleDateString()}</span>
            <code className="text-xs break-all">{linkFor(approved.token)}</code>
            <button type="button" onClick={() => navigator.clipboard?.writeText(linkFor(approved.token))} className="self-start text-xs font-semibold" style={{ color: "var(--pt-accent)" }}>Copy link</button>
          </div>
        )}
      </form>
    </div>
  );
}
