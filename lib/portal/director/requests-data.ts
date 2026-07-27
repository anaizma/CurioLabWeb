import { getDirectorContext } from "./session";

export interface DeletionRequestRow {
  deletionRequestId: string;
  subjectName: string;
  status: string;
  requestedLabel: string;
}

export interface ExportRequestRow {
  exportRequestId: string;
  subjectName: string;
  status: string;
  requestedLabel: string;
}

export interface RequestsView {
  deletions: DeletionRequestRow[];
  exportRequests: ExportRequestRow[];
  isSample: boolean;
}

function fmt(d: string | undefined | null): string { if (!d) return "—"; const t = new Date(d); return isNaN(t.getTime()) ? "—" : t.toLocaleDateString(); }

const SAMPLE_DELETIONS: DeletionRequestRow[] = [];
const SAMPLE_EXPORTS: ExportRequestRow[] = [];

export async function getRequestsView(): Promise<RequestsView> {
  const ctx = await getDirectorContext();
  if (!ctx) return { deletions: SAMPLE_DELETIONS, exportRequests: SAMPLE_EXPORTS, isSample: true };
  try {
    const [dr, xr] = await Promise.all([
      fetch(`${ctx.origin}/api/ops/deletion-requests`, { headers: { cookie: ctx.cookie }, cache: "no-store" }),
      fetch(`${ctx.origin}/api/ops/export-requests`, { headers: { cookie: ctx.cookie }, cache: "no-store" }),
    ]);
    if (!dr.ok || !xr.ok) return { deletions: SAMPLE_DELETIONS, exportRequests: SAMPLE_EXPORTS, isSample: true };
    const dData = (await dr.json()) as { items?: { deletionRequestId?: string; subjectDisplayName?: string; status?: string; requestedAt?: string }[] };
    const xData = (await xr.json()) as { items?: { exportRequestId?: string; subjectDisplayName?: string; status?: string; requestedAt?: string }[] };
    const deletions: DeletionRequestRow[] = (dData.items ?? []).map((d, i) => ({ deletionRequestId: d.deletionRequestId ?? `del${i}`, subjectName: d.subjectDisplayName ?? "—", status: d.status ?? "—", requestedLabel: fmt(d.requestedAt) }));
    const exportRequests: ExportRequestRow[] = (xData.items ?? []).map((x, i) => ({ exportRequestId: x.exportRequestId ?? `exp${i}`, subjectName: x.subjectDisplayName ?? "—", status: x.status ?? "—", requestedLabel: fmt(x.requestedAt) }));
    return { deletions, exportRequests, isSample: false };
  } catch { return { deletions: SAMPLE_DELETIONS, exportRequests: SAMPLE_EXPORTS, isSample: true }; }
}
