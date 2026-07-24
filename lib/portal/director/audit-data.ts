import { getDirectorContext } from "./session";

export interface AuditEntry {
  id: string;
  atLabel: string;
  action: string;
  subjectType: string;
  subjectId: string | null;
}

export interface AuditView {
  entries: AuditEntry[];
  isSample: boolean;
}

interface ApiEntry {
  id?: string;
  at?: string;
  action?: string;
  subjectType?: string;
  subjectId?: string | null;
}

function fmt(d: string | undefined): string {
  if (!d) return "—";
  const t = new Date(d);
  return isNaN(t.getTime()) ? "—" : t.toLocaleString();
}

const SAMPLE: AuditEntry[] = [
  { id: "a1", atLabel: "Jul 23, 2:14 PM", action: "invite.issued", subjectType: "invite", subjectId: "inv_sample_1" },
  { id: "a2", atLabel: "Jul 23, 11:02 AM", action: "membership.activated", subjectType: "membership", subjectId: "mem_7" },
  { id: "a3", atLabel: "Jul 22, 4:48 PM", action: "guardianship.verified", subjectType: "guardianship", subjectId: "gs_3" },
];

export async function getAuditView(): Promise<AuditView> {
  const ctx = await getDirectorContext();
  if (!ctx) return { entries: SAMPLE, isSample: true };
  try {
    const res = await fetch(
      `${ctx.origin}/api/ops/audit?chapterId=${encodeURIComponent(ctx.chapterId)}&limit=100`,
      { headers: { cookie: ctx.cookie }, cache: "no-store" },
    );
    if (!res.ok) return { entries: SAMPLE, isSample: true };
    const data = (await res.json()) as { entries?: ApiEntry[] };
    const entries: AuditEntry[] = (data.entries ?? []).map((e, i) => ({
      id: e.id ?? `e${i}`,
      atLabel: fmt(e.at),
      action: e.action ?? "—",
      subjectType: e.subjectType ?? "—",
      subjectId: e.subjectId ?? null,
    }));
    return { entries, isSample: false };
  } catch {
    return { entries: SAMPLE, isSample: true };
  }
}
