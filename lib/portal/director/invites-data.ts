import type { InviteRow } from "./types";
import { getDirectorContext } from "./session";

export interface InvitesView {
  chapterId: string | null;
  invites: InviteRow[];
  isSample: boolean;
}

const SAMPLE_INVITES: InviteRow[] = [
  { inviteId: "inv_sample_1", kind: "guardian", targetEmail: "parent@example.org", status: "pending", issuedLabel: "Jul 21", expiresLabel: "Jul 28" },
  { inviteId: "inv_sample_2", kind: "mentor", targetEmail: "mentor@example.org", status: "pending", issuedLabel: "Jul 20", expiresLabel: "Jul 27" },
  { inviteId: "inv_sample_3", kind: "staff", targetEmail: null, status: "accepted", issuedLabel: "Jul 18", expiresLabel: "—" },
];

/** Issuing + resend are LIVE (POST). No list GET exists yet, so the pending list
 *  is representative until GET /api/ops/invites lands. chapterId (present when a
 *  director is signed in) is what makes live issuing possible on the page. */
export async function getInvitesView(): Promise<InvitesView> {
  const ctx = await getDirectorContext();
  return { chapterId: ctx?.chapterId ?? null, invites: SAMPLE_INVITES, isSample: true };
}
