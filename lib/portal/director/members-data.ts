import { getDirectorContext } from "./session";

export type MemberStatus = "pending" | "active" | "suspended" | "lapsed";

export interface MemberRow {
  membershipId: string;
  displayName: string;
  role: string;
  status: MemberStatus;
  tier: string;
  podName: string;
}

export interface MembersView {
  members: MemberRow[];
  isSample: boolean;
}

const SAMPLE: MemberRow[] = [
  { membershipId: "mem_sample_1", displayName: "Maya R.", role: "student", status: "active", tier: "Builder", podName: "Robotics A" },
  { membershipId: "mem_sample_2", displayName: "Ari (new)", role: "student", status: "pending", tier: "—", podName: "—" },
  { membershipId: "mem_sample_3", displayName: "T. Alvarez", role: "junior_mentor", status: "active", tier: "—", podName: "Robotics A" },
  { membershipId: "mem_sample_4", displayName: "Priya S.", role: "student", status: "active", tier: "Explorer", podName: "Games B" },
];

export async function getMembersView(): Promise<MembersView> {
  await getDirectorContext();
  return { members: SAMPLE, isSample: true };
}
