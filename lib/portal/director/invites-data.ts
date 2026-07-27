import type { InviteRow } from "./types";
import { getDirectorContext } from "./session";

export interface InvitesView {
  chapterId: string | null;
  invites: InviteRow[];
  isSample: boolean;
}

const SAMPLE_INVITES: InviteRow[] = [];

function fmt(d: string | undefined | null): string { if (!d) return "—"; const t = new Date(d); return isNaN(t.getTime()) ? "—" : t.toLocaleDateString(); }

export async function getInvitesView(): Promise<InvitesView> {
  const ctx = await getDirectorContext();
  if (!ctx) return { chapterId: null, invites: SAMPLE_INVITES, isSample: true };
  try {
    const res = await fetch(`${ctx.origin}/api/ops/invites`, { headers: { cookie: ctx.cookie }, cache: "no-store" });
    if (!res.ok) return { chapterId: ctx.chapterId, invites: SAMPLE_INVITES, isSample: true };
    const data = (await res.json()) as { items?: { inviteId?: string; kind?: string; targetEmail?: string | null; status?: string; issuedAt?: string; expiresAt?: string }[] };
    const kinds = ["guardian", "mentor", "staff", "director", "admin"] as const;
    const statuses = ["pending", "accepted", "expired", "superseded"] as const;
    const invites: InviteRow[] = (data.items ?? []).map((i, idx) => ({
      inviteId: i.inviteId ?? `inv${idx}`,
      kind: (kinds as readonly string[]).includes(i.kind ?? "") ? (i.kind as InviteRow["kind"]) : "staff",
      targetEmail: i.targetEmail ?? null,
      status: (statuses as readonly string[]).includes(i.status ?? "") ? (i.status as InviteRow["status"]) : "pending",
      issuedLabel: fmt(i.issuedAt),
      expiresLabel: fmt(i.expiresAt),
    }));
    return { chapterId: ctx.chapterId, invites, isSample: false };
  } catch { return { chapterId: ctx.chapterId, invites: SAMPLE_INVITES, isSample: true }; }
}
