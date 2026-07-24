import type { DashboardSummary } from "./types";
import { getDirectorContext } from "./session";

const SAMPLE_SUMMARY: DashboardSummary = {
  newApplications: 4,
  pendingInvites: 3,
  guardianshipsToVerify: 2,
  mediaToReview: 1,
  openRequests: 0,
  activeMembers: 18,
  isSample: true,
};

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const ctx = await getDirectorContext();
  if (!ctx) return SAMPLE_SUMMARY;
  try {
    const res = await fetch(`${ctx.origin}/api/ops/dashboard`, { headers: { cookie: ctx.cookie }, cache: "no-store" });
    if (!res.ok) return SAMPLE_SUMMARY;
    const d = (await res.json()) as Partial<DashboardSummary>;
    return { newApplications: d.newApplications ?? 0, pendingInvites: d.pendingInvites ?? 0, guardianshipsToVerify: d.guardianshipsToVerify ?? 0, mediaToReview: d.mediaToReview ?? 0, openRequests: d.openRequests ?? 0, activeMembers: d.activeMembers ?? 0, isSample: false };
  } catch { return SAMPLE_SUMMARY; }
}
