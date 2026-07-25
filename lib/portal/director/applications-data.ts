import { getDirectorContext } from "./session";

export type ApplicationStatus = "submitted" | "screening" | "interview" | "accepted" | "declined";

export interface ApplicationRow {
  applicationId: string;
  status: ApplicationStatus;
  studentName: string;
  gradeLevel: string | null;
  termName: string | null;
  submittedLabel: string;
  // Only populated in the full-view list (?view=full) and in sample data.
  guardianName?: string | null;
  school?: string | null;
  contactEmail?: string | null;
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
  termId: string | null;
  termName: string | null;
  submittedLabel: string;
  answers: { question: string; answer: string }[];
  history: { at: string; note: string }[];
}

export interface TermOption {
  termId: string;
  name: string;
}

export interface ApplicationsView {
  applications: ApplicationRow[];
  /** The term the backend filtered to (most-recent by default, or the one requested); null when showing all terms. */
  activeTermId: string | null;
  activeTermName: string | null;
  full: boolean;
  isSample: boolean;
}

// ---- sample (representative) data -----------------------------------------
// Mirrors the live shape (full name, grade, school, contact, guardian, term) so the
// representative view exercises the same fields the connected endpoints now return.

const SAMPLE_TERMS: TermOption[] = [
  { termId: "term_fall26", name: "Fall 2026" },
  { termId: "term_summer26", name: "Summer 2026" },
];
/** All sample applications live in the most-recent sample term. */
const SAMPLE_TERM_ID = "term_fall26";

const SAMPLE: ApplicationDetail[] = [
  {
    applicationId: "app_sample_1", status: "submitted",
    studentName: "Ari Okafor", gradeLevel: "8", school: "Lincoln Middle School", contactEmail: "j.okafor@example.com",
    guardianName: "Jordan Okafor", guardianEmail: "j.okafor@example.com", termId: SAMPLE_TERM_ID, termName: "Fall 2026", submittedLabel: "Jul 22",
    answers: [
      { question: "What does the student want to build or explore?", answer: "A weather station that logs data to a small dashboard." },
      { question: "Prior experience", answer: "Some Scratch; a little Python from a summer camp." },
      { question: "Availability", answer: "Weekday evenings after 6pm." },
      { question: "Why CurioLab?", answer: "Wants to meet other kids who like building things and get a mentor." },
    ],
    history: [{ at: "Jul 22", note: "Submitted by guardian" }],
  },
  {
    applicationId: "app_sample_2", status: "screening",
    studentName: "Priya Nair", gradeLevel: "10", school: "Westfield High School", contactEmail: "r.nair@example.com",
    guardianName: "Rohan Nair", guardianEmail: "r.nair@example.com", termId: SAMPLE_TERM_ID, termName: "Fall 2026", submittedLabel: "Jul 21",
    answers: [
      { question: "What does the student want to build or explore?", answer: "A game that teaches younger kids fractions." },
      { question: "Prior experience", answer: "Unity tutorials; comfortable with C#." },
      { question: "Availability", answer: "Weekends." },
      { question: "Why CurioLab?", answer: "Wants structure and a co-founder to ship an actual game." },
    ],
    history: [{ at: "Jul 21", note: "Submitted" }, { at: "Jul 22", note: "Moved to screening" }],
  },
  {
    applicationId: "app_sample_3", status: "interview",
    studentName: "Diego Santos", gradeLevel: "7", school: "Oakridge Middle School", contactEmail: "m.santos@example.com",
    guardianName: "Maria Santos", guardianEmail: "m.santos@example.com", termId: SAMPLE_TERM_ID, termName: "Fall 2026", submittedLabel: "Jul 20",
    answers: [
      { question: "What does the student want to build or explore?", answer: "A robot that sorts recycling." },
      { question: "Prior experience", answer: "None yet — very curious." },
      { question: "Availability", answer: "Tuesday/Thursday afternoons." },
      { question: "Why CurioLab?", answer: "Loves taking things apart and wants to build something that helps the planet." },
    ],
    history: [{ at: "Jul 20", note: "Submitted" }, { at: "Jul 21", note: "Screened" }, { at: "Jul 23", note: "Interview scheduled" }],
  },
];

function fmt(d: string | undefined | null): string { if (!d) return "—"; const t = new Date(d); return isNaN(t.getTime()) ? "—" : t.toLocaleDateString(); }

/** Grade values arrive as the raw funnel answer ("8", "9th", "Grade 6"…). Prefix bare numbers. */
export function gradeLabel(g: string | null | undefined): string | null {
  if (g == null) return null;
  const t = String(g).trim();
  if (!t) return null;
  return /^\d+$/.test(t) ? `Grade ${t}` : t;
}

/** Funnel answer blobs are keyed by machine field names; turn them into readable questions. */
function humanizeKey(k: string): string {
  return k
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
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
  return Object.entries(blob as Record<string, unknown>).map(([k, v]) => ({
    question: humanizeKey(k),
    answer: typeof v === "string" ? v : JSON.stringify(v),
  }));
}

function toRow(a: ApplicationDetail): ApplicationRow {
  return {
    applicationId: a.applicationId,
    status: a.status,
    studentName: a.studentName,
    gradeLevel: a.gradeLevel,
    termName: a.termName,
    submittedLabel: a.submittedLabel,
    guardianName: a.guardianName,
    school: a.school,
    contactEmail: a.contactEmail,
  };
}

/** Sample rows honoring the requested term. Default (no termId) and "all" show every sample. */
function sampleRows(termId?: string): ApplicationRow[] {
  const all = SAMPLE.map(toRow);
  if (!termId || termId === "all" || termId === SAMPLE_TERM_ID) return all;
  return []; // samples only exist in the most-recent term
}

// ---- live reads -----------------------------------------------------------

interface LiveListItem {
  applicationId?: string;
  status?: string;
  studentName?: string | null;
  gradeLevel?: string | null;
  submittedAt?: string;
  termName?: string | null;
  guardianName?: string | null;
  school?: string | null;
  contactEmail?: string | null;
}
interface LiveListEnvelope {
  items?: LiveListItem[];
  activeTermId?: string | null;
  activeTermName?: string | null;
}

export async function getTerms(): Promise<{ terms: TermOption[]; isSample: boolean }> {
  const ctx = await getDirectorContext();
  if (!ctx) return { terms: SAMPLE_TERMS, isSample: true };
  try {
    const res = await fetch(`${ctx.origin}/api/ops/terms`, { headers: { cookie: ctx.cookie }, cache: "no-store" });
    if (!res.ok) return { terms: SAMPLE_TERMS, isSample: true };
    const data = (await res.json()) as { items?: { termId?: string; name?: string }[] };
    const terms = (data.items ?? []).map((t, i) => ({ termId: t.termId ?? `term${i}`, name: t.name ?? "—" }));
    return { terms, isSample: false };
  } catch { return { terms: SAMPLE_TERMS, isSample: true }; }
}

export async function getApplicationsView(opts?: { termId?: string; full?: boolean }): Promise<ApplicationsView> {
  const termId = opts?.termId;
  const full = opts?.full ?? false;
  const ctx = await getDirectorContext();
  if (!ctx) {
    const selected = termId && termId !== "all" ? termId : SAMPLE_TERM_ID;
    return {
      applications: sampleRows(termId),
      activeTermId: termId === "all" ? null : selected,
      activeTermName: termId === "all" ? null : (SAMPLE_TERMS.find((t) => t.termId === selected)?.name ?? null),
      full,
      isSample: true,
    };
  }
  try {
    // No termId → backend defaults to the most-recent term. ?termId=all shows every term.
    const params = new URLSearchParams();
    if (termId) params.set("termId", termId);
    if (full) params.set("view", "full");
    const qs = params.toString() ? `?${params.toString()}` : "";
    const res = await fetch(`${ctx.origin}/api/ops/applications${qs}`, { headers: { cookie: ctx.cookie }, cache: "no-store" });
    if (!res.ok) return { applications: sampleRows(termId), activeTermId: null, activeTermName: null, full, isSample: true };
    const data = (await res.json()) as LiveListEnvelope;
    const applications: ApplicationRow[] = (data.items ?? []).map((a, i) => ({
      applicationId: a.applicationId ?? `app${i}`,
      status: mapAppStatus(a.status),
      studentName: a.studentName ?? "—",
      gradeLevel: a.gradeLevel ?? null,
      termName: a.termName ?? null,
      submittedLabel: fmt(a.submittedAt),
      guardianName: full ? (a.guardianName ?? null) : undefined,
      school: full ? (a.school ?? null) : undefined,
      contactEmail: full ? (a.contactEmail ?? null) : undefined,
    }));
    return {
      applications,
      activeTermId: data.activeTermId ?? null,
      activeTermName: data.activeTermName ?? null,
      full,
      isSample: false,
    };
  } catch {
    return { applications: sampleRows(termId), activeTermId: null, activeTermName: null, full, isSample: true };
  }
}

interface LiveDetail {
  applicationId?: string;
  status?: string;
  submittedAt?: string;
  termId?: string | null;
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
          termId: d.termId ?? null,
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
