import { getDirectorContext } from "./session";

export type GuardianshipStatus = "pending" | "verified" | "rejected" | "revoked";

export interface GuardianshipRow {
  guardianshipId: string;
  status: GuardianshipStatus;
  guardianName: string;
  nameOnForm: string;
  studentName: string;
}

export interface GuardianshipsView {
  guardianships: GuardianshipRow[];
  isSample: boolean;
}

const SAMPLE: GuardianshipRow[] = [
  { guardianshipId: "gs_sample_1", status: "pending", guardianName: "Jordan Okafor", nameOnForm: "Jordan Okafor", studentName: "Ari" },
  { guardianshipId: "gs_sample_2", status: "pending", guardianName: "R. Nair", nameOnForm: "Rohan Nair", studentName: "Priya" },
  { guardianshipId: "gs_sample_3", status: "verified", guardianName: "Marisol Santos", nameOnForm: "Marisol Santos", studentName: "Diego" },
];

export async function getGuardianshipsView(): Promise<GuardianshipsView> {
  await getDirectorContext();
  return { guardianships: SAMPLE, isSample: true };
}
