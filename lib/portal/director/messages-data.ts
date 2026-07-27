import { getDirectorContext } from "./session";

export interface ThreadMessage {
  id: string;
  who: "staff" | "guardian";
  name: string;
  text: string;
  timeLabel: string;
}
export interface ThreadSummary {
  id: string;
  guardianName: string;
  subject: string | null;
  lastPreview: string;
  lastLabel: string;
}
export interface ThreadDetail {
  id: string;
  guardianName: string;
  subject: string | null;
  messages: ThreadMessage[];
}
export interface ThreadsView {
  threads: ThreadSummary[];
  isSample: boolean;
}

function fmt(d: string | undefined | null): string {
  if (!d) return "—";
  const t = new Date(d);
  return isNaN(t.getTime()) ? "—" : t.toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}

const SAMPLE_THREADS: ThreadSummary[] = [];
const SAMPLE_DETAIL: Record<string, ThreadDetail> = {};

export async function getThreadsView(): Promise<ThreadsView> {
  const ctx = await getDirectorContext();
  if (!ctx) return { threads: SAMPLE_THREADS, isSample: true };
  try {
    const res = await fetch(`${ctx.origin}/api/ops/messages?chapterId=${encodeURIComponent(ctx.chapterId)}`, { headers: { cookie: ctx.cookie }, cache: "no-store" });
    if (!res.ok) return { threads: SAMPLE_THREADS, isSample: true };
    const data = (await res.json()) as { items?: { id?: string; guardianName?: string; subject?: string | null; lastMessage?: { body?: string; sentAt?: string } | null; lastMessageAt?: string }[] };
    const threads: ThreadSummary[] = (data.items ?? []).map((t, i) => ({
      id: t.id ?? `thr${i}`,
      guardianName: t.guardianName ?? "Guardian",
      subject: t.subject ?? null,
      lastPreview: t.lastMessage?.body ?? "(no messages yet)",
      lastLabel: fmt(t.lastMessage?.sentAt ?? t.lastMessageAt),
    }));
    return { threads, isSample: false };
  } catch {
    return { threads: SAMPLE_THREADS, isSample: true };
  }
}

export async function getThreadDetail(id: string): Promise<{ detail: ThreadDetail | null; isSample: boolean }> {
  const ctx = await getDirectorContext();
  if (ctx) {
    try {
      const res = await fetch(`${ctx.origin}/api/ops/messages/${id}`, { headers: { cookie: ctx.cookie }, cache: "no-store" });
      if (res.ok) {
        const d = (await res.json()) as { id?: string; guardianName?: string; subject?: string | null; messages?: { id?: string; senderRole?: string; senderName?: string; body?: string; sentAt?: string }[] };
        const detail: ThreadDetail = {
          id: d.id ?? id,
          guardianName: d.guardianName ?? "Guardian",
          subject: d.subject ?? null,
          messages: (d.messages ?? []).map((m, i) => ({
            id: m.id ?? `m${i}`,
            who: m.senderRole === "guardian" ? "guardian" : "staff",
            name: m.senderName ?? "—",
            text: m.body ?? "",
            timeLabel: fmt(m.sentAt),
          })),
        };
        return { detail, isSample: false };
      }
    } catch {
      /* fall through to sample */
    }
  }
  const detail = SAMPLE_DETAIL[id] ?? SAMPLE_DETAIL["thr_sample_1"] ?? null;
  return { detail, isSample: true };
}
