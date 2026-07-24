import { getDirectorContext } from "./session";

export interface EnrollmentRow {
  enrollmentRecordId: string;
  studentName: string;
  termName: string;
  guardianNameOnForm: string;
  signatureLabel: string;
  hasAccount: boolean;
}

export interface EnrollmentsView {
  enrollments: EnrollmentRow[];
  isSample: boolean;
}

function fmt(d: string | undefined | null): string { if (!d) return "—"; const t = new Date(d); return isNaN(t.getTime()) ? "—" : t.toLocaleDateString(); }

const SAMPLE: EnrollmentRow[] = [
  { enrollmentRecordId: "enr_sample_1", studentName: "Diego", termName: "Fall 2026", guardianNameOnForm: "Marisol Santos", signatureLabel: "Jul 23", hasAccount: false },
  { enrollmentRecordId: "enr_sample_2", studentName: "Maya R.", termName: "Fall 2026", guardianNameOnForm: "L. Rivera", signatureLabel: "Jul 15", hasAccount: true },
];

export async function getEnrollmentsView(): Promise<EnrollmentsView> {
  const ctx = await getDirectorContext();
  if (!ctx) return { enrollments: SAMPLE, isSample: true };
  try {
    const res = await fetch(`${ctx.origin}/api/ops/enrollments`, { headers: { cookie: ctx.cookie }, cache: "no-store" });
    if (!res.ok) return { enrollments: SAMPLE, isSample: true };
    const data = (await res.json()) as { items?: { enrollmentRecordId?: string; studentDisplayName?: string | null; termName?: string | null; guardianNameOnForm?: string; signatureDate?: string | null; hasAccount?: boolean }[] };
    const enrollments: EnrollmentRow[] = (data.items ?? []).map((e, i) => ({
      enrollmentRecordId: e.enrollmentRecordId ?? `enr${i}`,
      studentName: e.studentDisplayName ?? "—",
      termName: e.termName ?? "—",
      guardianNameOnForm: e.guardianNameOnForm ?? "—",
      signatureLabel: fmt(e.signatureDate),
      hasAccount: Boolean(e.hasAccount),
    }));
    return { enrollments, isSample: false };
  } catch { return { enrollments: SAMPLE, isSample: true }; }
}
