import { getDirectorContext } from "./session";

export type ApplicationStatus = "submitted" | "screening" | "interview" | "accepted" | "declined";

export interface ApplicationRow {
  applicationId: string;
  status: ApplicationStatus;
  studentName: string;
  gradeLevel: string | null;
  termName: string | null;
  submittedLabel: string;
}

export interface ApplicationDetail {
  applicationId: string;
  status: ApplicationStatus;
  studentName: string;
  gradeLevel: string | null;
  school: string | null;
  contactEmail: string | null;
  guardianName: string;
  guardianEmail: string | null;
  termName: string | null;
  submittedLabel: string;
  answers: { question: string; answer: string }[];
  history: { at: string; note: string }[];
}

export interface ApplicationsView {
  applications: ApplicationRow[];
  /** The term the backend filtered to (most-recent by default, or the one requested); null when showing all terms. */
  activeTermName: string | null;
  allTerms: boolean;
  isSample: boolean;
}

// Sample records mirror the live shape (full name, grade, school, contact, guardian) so the
// representative view exercises the same fields the connected endpoint now returns.
const SAMPLE: ApplicationDetail[] = [
  {
    applicationId: "app_sample_1", status: "submitted",
    studentName: "Ari Okafor", gradeLevel: "8", school: "Lincoln Middle School", contactEmail: "j.okafor@example.com",
    guardianName: "Jordan Okafor", guardianEmail: "j.okafor@example.com", termName: "Fall 2026", submittedLabel: "Jul 22",
    answers: [
      { question: "What does the student want to build or explore?", answer: "A weather station that logs data to a small dashboard." },
      { question: "Prior experience", answer: "Some Scratch; a little Python from a summer camp." },
      { question: "Availability", answer: "Weekday evenings after 6pm." },
    ],
    history: [{ at: "Jul 22", note: "Submitted by guardian" }],
  },
  {
    applicationId: "app_sample_2", status: "screening",
    studentName: "Priya Nair", gradeLevel: "10", school: "Westfield High School", contactEmail: "r.nair@example.com",
    guardianName: "Rohan Nair", guardianEmail: "r.nair@example.com", termName: "Fall 2026", submittedLabel: "Jul 21",
    answers: [
      { question: "What does the student want to build or explore?", answer: "A game that teaches younger kids fractions." },
      { question: "Prior experience", answer: "Unity tutorials; comfortable with C#." },
      { question: "Availability", answer: "Weekends." },
    ],
    history: [{ at: "Jul 21", note: "Submitted" }, { at: "Jul 22", note: "Moved to screening" }],
  },
  {
    applicationId: "app_sample_3", status: "interview",
    studentName: "Diego Santos", gradeLevel: "7", school: "Oakridge Middle School", contactEmail: "m.santos@example.com",
    guardianName: "Maria Santos", guardianEmail: "m.santos@example.com", termName: "Fall 2026", submittedLabel: "Jul 20",
    answers: [
      { question: "What does the student want to build or explore?", answer: "A robot that sorts recycling." },
      { question: "Prior experience", answer: "None yet — very curious." },
      { question: "Availability", answer: "Tuesday/Thursday afternoons." },
    ],
    history: [{ at: "Jul 20", note: "Submitted" }, { at: "Jul 21", note: "Screened" }, { at: "Jul 23", note: "Interview scheduled" }],
  },
];

const SAMPLE_ACTIVE_TERM = "Fall 2026";

function fmt(d: string | undefined | null): string { if (!d) return "—"; const t = new Date(d); return isNaN(t.getTime()) ? "—" : t.toLocaleDateString(); }

/** Grade values arrive as the raw funnel answer ("8", "9th", "Grade 6"…). Prefix bare numbers. */
export function gradeLabel(g: string | null | undefined): string | null {
  if (g == null) return null;
  const t = String(g).trim();
  if (!t) return null;
  return /^\d+$/.test(t) ? `Grade ${t}` : t;
}

function mapAppStatus(s: string | undefined): ApplicationStatus {
  if (s === "screening") return "screening";
  if (s === "interview" || s === "interview_scheduled") return "interview";
  if (s === "accepted" || s === "enrolled") return "accepted";
  if (s === "declined" || s === "withdrawn") return "declined";
  return "submitted";
}
function flatten(blob: unknown): { question: string; answer: string }[] {
  if (!blob || typeof blob !== "object") return [];
  return Object.entries(blob as Record<string, unknown>).map(([k, v]) => ({ question: k, answer: typeof v === "string" ? v : JSON.stringify(v) }));
}

function toRow(a: ApplicationDetail): ApplicationRow {
  return {
    applicationId: a.applicationId,
    status: a.status,
    studentName: a.studentName,
    gradeLevel: a.gradeLevel,
    termName: a.termName,
    submittedLabel: a.submittedLabel,
  };
}

interface LiveListItem {
  applicationId?: string;
  status?: string;
  studentName?: string | null;
  gradeLevel?: string | null;
  submittedAt?: string;
  termName?: string | null;
}
interface LiveListEnvelope {
  items?: LiveListItem[];
  activeTermName?: string | null;
}

export async function getApplicationsView(opts?: { allTerms?: boolean }): Promise<ApplicationsView> {
  const allTerms = opts?.allTerms ?? false;
  const ctx = await getDirectorContext();
  if (!ctx) {
    return { applications: SAMPLE.map(toRow), activeTermName: SAMPLE_ACTIVE_TERM, allTerms, isSample: true };
  }
  try {
    // Backend defaults to the most-recent term; ?termId=all opts into every term.
    const qs = allTerms ? "?termId=all" : "";
    const res = await fetch(`${ctx.origin}/api/ops/applications${qs}`, { headers: { cookie: ctx.cookie }, cache: "no-store" });
    if (!res.ok) return { applications: SAMPLE.map(toRow), activeTermName: SAMPLE_ACTIVE_TERM, allTerms, isSample: true };
    const data = (await res.json()) as LiveListEnvelope;
    const applications: ApplicationRow[] = (data.items ?? []).map((a, i) => ({
      applicationId: a.applicationId ?? `app${i}`,
      status: mapAppStatus(a.status),
      studentName: a.studentName ?? "—",
      gradeLevel: a.gradeLevel ?? null,
      termName: a.termName ?? null,
      submittedLabel: fmt(a.submittedAt),
    }));
    return { applications, activeTermName: allTerms ? null : (data.activeTermName ?? null), allTerms, isSample: false };
  } catch {
    return { applications: SAMPLE.map(toRow), activeTermName: SAMPLE_ACTIVE_TERM, allTerms, isSample: true };
  }
}

interface LiveDetail {
  applicationId?: string;
  status?: string;
  submittedAt?: string;
  termName?: string | null;
  student?: { fullName?: string | null; gradeLevel?: string | null; school?: string | null; contactEmail?: string | null };
  guardian?: { fullName?: string | null; email?: string | null };
  answers?: { stage2a?: unknown; stage2b?: unknown; stage2c?: unknown };
  history?: { from?: string | null; to?: string; at?: string; note?: string | null }[];
}

export async function getApplicationDetail(id: string): Promise<{ detail: ApplicationDetail | null; isSample: boolean }> {
  const ctx = await getDirectorContext();
  if (ctx) {
    try {
      const res = await fetch(`${ctx.origin}/api/ops/applications/${id}`, { headers: { cookie: ctx.cookie }, cache: "no-store" });
      if (res.ok) {
        const d = (await res.json()) as LiveDetail;
        const detail: ApplicationDetail = {
          applicationId: d.applicationId ?? id,
          status: mapAppStatus(d.status),
          studentName: d.student?.fullName ?? "—",
          gradeLevel: d.student?.gradeLevel ?? null,
          school: d.student?.school ?? null,
          contactEmail: d.student?.contactEmail ?? null,
          guardianName: d.guardian?.fullName ?? "—",
          guardianEmail: d.guardian?.email ?? null,
          termName: d.termName ?? null,
          submittedLabel: fmt(d.submittedAt),
          answers: [...flatten(d.answers?.stage2a), ...flatten(d.answers?.stage2b)],
          history: (d.history ?? []).map((h) => ({ at: fmt(h.at), note: h.note ?? `${h.from ?? "—"} → ${h.to ?? "—"}` })),
        };
        return { detail, isSample: false };
      }
    } catch { /* fall through to sample */ }
  }
  const detail = SAMPLE.find((a) => a.applicationId === id) ?? SAMPLE[0] ?? null;
  return { detail, isSample: true };
}
