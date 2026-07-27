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

const SAMPLE: MemberRow[] = [];

export async function getMembersView(): Promise<MembersView> {
  const ctx = await getDirectorContext();
  if (!ctx) return { members: SAMPLE, isSample: true };
  try {
    const res = await fetch(`${ctx.origin}/api/ops/memberships`, { headers: { cookie: ctx.cookie }, cache: "no-store" });
    if (!res.ok) return { members: SAMPLE, isSample: true };
    const data = (await res.json()) as { items?: { membershipId?: string; displayName?: string; role?: string; status?: string; tier?: string | null; podId?: string | null }[] };
    const mapStatus = (s: string | undefined): MemberStatus => (s === "active" || s === "pending" || s === "suspended" ? s : "lapsed");
    const members: MemberRow[] = (data.items ?? []).map((m, idx) => ({
      membershipId: m.membershipId ?? `mem${idx}`,
      displayName: m.displayName ?? "—",
      role: m.role ?? "—",
      status: mapStatus(m.status),
      tier: m.tier ?? "—",
      podName: m.podId ?? "—",
    }));
    return { members, isSample: false };
  } catch { return { members: SAMPLE, isSample: true }; }
}
