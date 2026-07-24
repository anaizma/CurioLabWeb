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
  const ctx = await getDirectorContext();
  if (!ctx) return { guardianships: SAMPLE, isSample: true };
  try {
    const res = await fetch(`${ctx.origin}/api/ops/guardianships`, { headers: { cookie: ctx.cookie }, cache: "no-store" });
    if (!res.ok) return { guardianships: SAMPLE, isSample: true };
    const data = (await res.json()) as { items?: { guardianshipId?: string; status?: string; guardianNameOnAccount?: string; studentDisplayName?: string; nameOnForm?: string }[] };
    const statuses = ["pending", "verified", "rejected", "revoked"] as const;
    const guardianships: GuardianshipRow[] = (data.items ?? []).map((g, idx) => ({
      guardianshipId: g.guardianshipId ?? `gs${idx}`,
      status: (statuses as readonly string[]).includes(g.status ?? "") ? (g.status as GuardianshipRow["status"]) : "pending",
      guardianName: g.guardianNameOnAccount ?? "—",
      nameOnForm: g.nameOnForm ?? "—",
      studentName: g.studentDisplayName ?? "—",
    }));
    return { guardianships, isSample: false };
  } catch { return { guardianships: SAMPLE, isSample: true }; }
}
