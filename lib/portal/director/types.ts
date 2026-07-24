export type InviteStatus = "pending" | "accepted" | "expired" | "superseded";

export interface InviteRow {
  inviteId: string;
  kind: "guardian" | "mentor" | "staff" | "director" | "admin";
  targetEmail: string | null;
  status: InviteStatus;
  issuedLabel: string;
  expiresLabel: string;
}

export interface DashboardSummary {
  newApplications: number;
  pendingInvites: number;
  guardianshipsToVerify: number;
  mediaToReview: number;
  openRequests: number;
  activeMembers: number;
  isSample: boolean;
}
