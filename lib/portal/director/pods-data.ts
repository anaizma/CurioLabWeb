import { getDirectorContext } from "./session";

export interface TermRow {
  termId: string;
  name: string;
  startsLabel: string;
  endsLabel: string;
}

export interface PodRow {
  podId: string;
  name: string;
  termName: string;
  mentorName: string;
  memberCount: number;
}

export interface PodsView {
  terms: TermRow[];
  pods: PodRow[];
  isSample: boolean;
}

function fmt(d: string | undefined | null): string { if (!d) return "—"; const t = new Date(d); return isNaN(t.getTime()) ? "—" : t.toLocaleDateString(); }

const SAMPLE_TERMS: TermRow[] = [];
const SAMPLE_PODS: PodRow[] = [];

export async function getPodsView(): Promise<PodsView> {
  const ctx = await getDirectorContext();
  if (!ctx) return { terms: SAMPLE_TERMS, pods: SAMPLE_PODS, isSample: true };
  try {
    const [tr, pr] = await Promise.all([
      fetch(`${ctx.origin}/api/ops/terms`, { headers: { cookie: ctx.cookie }, cache: "no-store" }),
      fetch(`${ctx.origin}/api/ops/pods`, { headers: { cookie: ctx.cookie }, cache: "no-store" }),
    ]);
    if (!tr.ok || !pr.ok) return { terms: SAMPLE_TERMS, pods: SAMPLE_PODS, isSample: true };
    const tData = (await tr.json()) as { items?: { termId?: string; name?: string; startsOn?: string; endsOn?: string }[] };
    const pData = (await pr.json()) as { items?: { podId?: string; name?: string; termId?: string; mentorDisplayName?: string | null; memberCount?: number }[] };
    const terms: TermRow[] = (tData.items ?? []).map((t, i) => ({ termId: t.termId ?? `term${i}`, name: t.name ?? "—", startsLabel: fmt(t.startsOn), endsLabel: fmt(t.endsOn) }));
    const termName = new Map(terms.map((t) => [t.termId, t.name]));
    const pods: PodRow[] = (pData.items ?? []).map((p, i) => ({ podId: p.podId ?? `pod${i}`, name: p.name ?? "—", termName: (p.termId && termName.get(p.termId)) || "—", mentorName: p.mentorDisplayName ?? "—", memberCount: p.memberCount ?? 0 }));
    return { terms, pods, isSample: false };
  } catch { return { terms: SAMPLE_TERMS, pods: SAMPLE_PODS, isSample: true }; }
}
