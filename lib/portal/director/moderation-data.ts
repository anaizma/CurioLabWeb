import { getDirectorContext } from "./session";

export type ModerationClass = "safety" | "ordinary";

export interface ModerationReport {
  reportId: string;
  targetType: string;
  targetId: string;
  reportClass: ModerationClass;
  reason: string;
  dueLabel: string;
  filedLabel: string;
  acknowledged: boolean;
  escalated: boolean;
}

export interface ModerationView {
  reports: ModerationReport[];
  isSample: boolean;
}

interface ApiReport {
  reportId?: string;
  targetType?: string;
  targetId?: string;
  class?: string;
  reason?: string;
  dueAt?: string;
  filedAt?: string;
  acknowledgedAt?: string | null;
  escalatedAt?: string | null;
}

function fmt(d: string | undefined | null): string {
  if (!d) return "—";
  const t = new Date(d);
  return isNaN(t.getTime()) ? "—" : t.toLocaleDateString();
}

const SAMPLE: ModerationReport[] = [];

export async function getModerationView(): Promise<ModerationView> {
  const ctx = await getDirectorContext();
  if (!ctx) return { reports: SAMPLE, isSample: true };
  try {
    const res = await fetch(
      `${ctx.origin}/api/lab/moderation/queue?chapterId=${encodeURIComponent(ctx.chapterId)}`,
      { headers: { cookie: ctx.cookie }, cache: "no-store" },
    );
    if (!res.ok) return { reports: SAMPLE, isSample: true };
    const data = (await res.json()) as { reports?: ApiReport[] };
    const reports: ModerationReport[] = (data.reports ?? []).map((r, i) => ({
      reportId: r.reportId ?? `r${i}`,
      targetType: r.targetType ?? "—",
      targetId: r.targetId ?? "—",
      reportClass: r.class === "safety" ? "safety" : "ordinary",
      reason: r.reason ?? "",
      dueLabel: fmt(r.dueAt),
      filedLabel: fmt(r.filedAt),
      acknowledged: r.acknowledgedAt != null,
      escalated: r.escalatedAt != null,
    }));
    return { reports, isSample: false };
  } catch {
    return { reports: SAMPLE, isSample: true };
  }
}
