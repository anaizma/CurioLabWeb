import { getDirectorContext } from "./session";

export type ApplicationStatus = "submitted" | "screening" | "interview" | "accepted" | "declined";

export interface ApplicationRow {
  applicationId: string;
  status: ApplicationStatus;
  studentDisplayName: string;
  guardianDisplayName: string;
  submittedLabel: string;
}

export interface ApplicationDetail extends ApplicationRow {
  answers: { question: string; answer: string }[];
  history: { at: string; note: string }[];
}

export interface ApplicationsView {
  applications: ApplicationRow[];
  isSample: boolean;
}

const SAMPLE: ApplicationDetail[] = [
  {
    applicationId: "app_sample_1", status: "submitted", studentDisplayName: "Ari (Grade 8)", guardianDisplayName: "J. Okafor", submittedLabel: "Jul 22",
    answers: [
      { question: "What does the student want to build or explore?", answer: "A weather station that logs data to a small dashboard." },
      { question: "Prior experience", answer: "Some Scratch; a little Python from a summer camp." },
      { question: "Availability", answer: "Weekday evenings after 6pm." },
    ],
    history: [{ at: "Jul 22", note: "Submitted by guardian" }],
  },
  {
    applicationId: "app_sample_2", status: "screening", studentDisplayName: "Priya (Grade 10)", guardianDisplayName: "R. Nair", submittedLabel: "Jul 21",
    answers: [
      { question: "What does the student want to build or explore?", answer: "A game that teaches younger kids fractions." },
      { question: "Prior experience", answer: "Unity tutorials; comfortable with C#." },
      { question: "Availability", answer: "Weekends." },
    ],
    history: [{ at: "Jul 21", note: "Submitted" }, { at: "Jul 22", note: "Moved to screening" }],
  },
  {
    applicationId: "app_sample_3", status: "interview", studentDisplayName: "Diego (Grade 7)", guardianDisplayName: "M. Santos", submittedLabel: "Jul 20",
    answers: [
      { question: "What does the student want to build or explore?", answer: "A robot that sorts recycling." },
      { question: "Prior experience", answer: "None yet — very curious." },
      { question: "Availability", answer: "Tuesday/Thursday afternoons." },
    ],
    history: [{ at: "Jul 20", note: "Submitted" }, { at: "Jul 21", note: "Screened" }, { at: "Jul 23", note: "Interview scheduled" }],
  },
];

function fmt(d: string | undefined | null): string { if (!d) return "—"; const t = new Date(d); return isNaN(t.getTime()) ? "—" : t.toLocaleDateString(); }

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
    studentDisplayName: a.studentDisplayName,
    guardianDisplayName: a.guardianDisplayName,
    submittedLabel: a.submittedLabel,
  };
}

export async function getApplicationsView(): Promise<ApplicationsView> {
  const ctx = await getDirectorContext();
  if (!ctx) return { applications: SAMPLE.map(toRow), isSample: true };
  try {
    const res = await fetch(`${ctx.origin}/api/ops/applications`, { headers: { cookie: ctx.cookie }, cache: "no-store" });
    if (!res.ok) return { applications: SAMPLE.map(toRow), isSample: true };
    const data = (await res.json()) as { items?: { applicationId?: string; status?: string; studentDisplayName?: string | null; guardianDisplayName?: string | null; submittedAt?: string }[] };
    const applications: ApplicationRow[] = (data.items ?? []).map((a, i) => ({ applicationId: a.applicationId ?? `app${i}`, status: mapAppStatus(a.status), studentDisplayName: a.studentDisplayName ?? "—", guardianDisplayName: a.guardianDisplayName ?? "—", submittedLabel: fmt(a.submittedAt) }));
    return { applications, isSample: false };
  } catch { return { applications: SAMPLE.map(toRow), isSample: true }; }
}

export async function getApplicationDetail(id: string): Promise<{ detail: ApplicationDetail | null; isSample: boolean }> {
  const ctx = await getDirectorContext();
  if (ctx) {
    try {
      const res = await fetch(`${ctx.origin}/api/ops/applications/${id}`, { headers: { cookie: ctx.cookie }, cache: "no-store" });
      if (res.ok) {
        const d = (await res.json()) as { applicationId?: string; status?: string; submittedAt?: string; student?: { displayName?: string | null }; guardian?: { displayName?: string | null }; answers?: { stage2a?: unknown; stage2b?: unknown }; history?: { from?: string | null; to?: string; at?: string; note?: string | null }[] };
        const detail: ApplicationDetail = {
          applicationId: d.applicationId ?? id,
          status: mapAppStatus(d.status),
          studentDisplayName: d.student?.displayName ?? "—",
          guardianDisplayName: d.guardian?.displayName ?? "—",
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
