import { getDirectorContext } from "./session";

export interface MediaRow {
  mediaId: string;
  projectTitle: string;
  reviewStatus: string;
  depictionsCount: number;
  flaggedReason: string | null;
}

export interface MediaView {
  media: MediaRow[];
  isSample: boolean;
}

function fmt(d: string | undefined | null): string { if (!d) return "—"; const t = new Date(d); return isNaN(t.getTime()) ? "—" : t.toLocaleDateString(); }

const SAMPLE: MediaRow[] = [];

export async function getMediaView(): Promise<MediaView> {
  const ctx = await getDirectorContext();
  if (!ctx) return { media: SAMPLE, isSample: true };
  try {
    const res = await fetch(`${ctx.origin}/api/ops/media/review-queue`, { headers: { cookie: ctx.cookie }, cache: "no-store" });
    if (!res.ok) return { media: SAMPLE, isSample: true };
    const data = (await res.json()) as { items?: { mediaId?: string; projectTitle?: string | null; reviewStatus?: string; depictions?: unknown[] }[] };
    const media: MediaRow[] = (data.items ?? []).map((m, i) => ({
      mediaId: m.mediaId ?? `med${i}`,
      projectTitle: m.projectTitle ?? "Untitled project",
      reviewStatus: m.reviewStatus ?? "pending_review",
      depictionsCount: Array.isArray(m.depictions) ? m.depictions.length : 0,
      flaggedReason: null,
    }));
    return { media, isSample: false };
  } catch { return { media: SAMPLE, isSample: true }; }
}
