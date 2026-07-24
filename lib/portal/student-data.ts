import { cookies, headers } from "next/headers";
import type { StudentProfile, StudentProject, ProjectStatus } from "./types";
import { REPRESENTATIVE_PROFILE } from "./sample";

interface ApiProject { projectId?: string; title?: string; summary?: string | null; status?: string }
interface ApiProfile {
  subjectAccountId?: string; displayName?: string; tier?: string | null;
  membership?: { chapterName?: string } | null; projects?: ApiProject[]; mentorHours?: number;
  narrative?: { body?: string; status?: string } | null;
}

function mapStatus(s: string | undefined): ProjectStatus {
  return s === "verified" || s === "submitted" || s === "public_listed" ? s : "draft";
}

/** Map the GET /api/profile/:id response into the presentational model. Fields the
 *  API does not carry (per-post visibility, session/newsletter counts) default to
 *  honest zero-states — the feed then shows its empty state for a real new student. */
function mapProfile(p: ApiProfile): StudentProfile {
  const name = p.displayName ?? "Student";
  const projects: StudentProject[] = (p.projects ?? []).map((pr, i) => ({
    id: pr.projectId ?? `p${i}`,
    title: pr.title ?? "Untitled project",
    summary: pr.summary ?? "",
    status: mapStatus(pr.status),
    language: null,
    dateLabel: "",
  }));
  const verifiedCount = projects.filter((pr) => pr.status === "verified" || pr.status === "public_listed").length;
  return {
    subjectAccountId: p.subjectAccountId ?? "",
    displayName: name,
    initial: name.trim().charAt(0).toUpperCase() || "?",
    tier: p.tier ?? null,
    chapterName: p.membership?.chapterName ?? "",
    joinedLabel: "",
    verified: verifiedCount > 0,
    stats: { verifiedProjects: verifiedCount, sessions: 0, inNewsletter: 0, tier: p.tier ?? "—" },
    narrative: p.narrative?.body
      ? { body: p.narrative.body, status: p.narrative.status === "published" ? "published" : "pending_review" }
      : null,
    skills: [],
    projects,
    timeline: [],
    isSample: false,
  };
}

/** Read the live session (cl_session) → profile; fall back to representative data. */
export async function getStudentProfile(): Promise<StudentProfile> {
  try {
    const session = (await cookies()).get("cl_session");
    if (!session) return REPRESENTATIVE_PROFILE;
    const host = (await headers()).get("host");
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? (host ? `http://${host}` : "");
    if (!origin) return REPRESENTATIVE_PROFILE;
    const cookie = `cl_session=${session.value}`;

    const sres = await fetch(`${origin}/api/auth/session`, { headers: { cookie }, cache: "no-store" });
    if (!sres.ok) return REPRESENTATIVE_PROFILE;
    const s = (await sres.json()) as { accountId?: string; memberships?: { role?: string }[] };
    const isStudent = (s.memberships ?? []).some((m) => m.role === "student" || m.role === "alumni");
    if (!s.accountId || !isStudent) return REPRESENTATIVE_PROFILE;

    const pres = await fetch(`${origin}/api/profile/${s.accountId}`, { headers: { cookie }, cache: "no-store" });
    if (!pres.ok) return REPRESENTATIVE_PROFILE;
    return mapProfile((await pres.json()) as ApiProfile);
  } catch {
    return REPRESENTATIVE_PROFILE;
  }
}
