import type { DashboardSummary } from "./types";
import { getDirectorContext } from "./session";

// Not sample data: the ZERO summary returned when the dashboard cannot be read.
// Invented counts were worse than useless here — a director glancing at "4 new
// applications" had no way to tell it was fiction. Zeros plus the banner say
// plainly that nothing could be loaded.
const EMPTY_SUMMARY: DashboardSummary = {
  newApplications: 0,
  pendingInvites: 0,
  guardianshipsToVerify: 0,
  mediaToReview: 0,
  openRequests: 0,
  activeMembers: 0,
  isSample: true,
};

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const ctx = await getDirectorContext();
  if (!ctx) return EMPTY_SUMMARY;
  try {
    const res = await fetch(`${ctx.origin}/api/ops/dashboard`, { headers: { cookie: ctx.cookie }, cache: "no-store" });
    if (!res.ok) return EMPTY_SUMMARY;
    const d = (await res.json()) as Partial<DashboardSummary>;
    return { newApplications: d.newApplications ?? 0, pendingInvites: d.pendingInvites ?? 0, guardianshipsToVerify: d.guardianshipsToVerify ?? 0, mediaToReview: d.mediaToReview ?? 0, openRequests: d.openRequests ?? 0, activeMembers: d.activeMembers ?? 0, isSample: false };
  } catch { return EMPTY_SUMMARY; }
}
