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

/** No chapter-summary GET exists yet (see director-portal-read-endpoints.md).
 *  Return the representative summary until GET /api/ops/dashboard (or the list
 *  GETs it derives from) land; isSample stays true so the banner shows. */
export async function getDashboardSummary(): Promise<DashboardSummary> {
  const ctx = await getDirectorContext();
  if (!ctx) return SAMPLE_SUMMARY;
  // Wire real counts here once the surface GETs exist.
  return SAMPLE_SUMMARY;
}
