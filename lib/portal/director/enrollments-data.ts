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

const SAMPLE: EnrollmentRow[] = [
  { enrollmentRecordId: "enr_sample_1", studentName: "Diego", termName: "Fall 2026", guardianNameOnForm: "Marisol Santos", signatureLabel: "Jul 23", hasAccount: false },
  { enrollmentRecordId: "enr_sample_2", studentName: "Maya R.", termName: "Fall 2026", guardianNameOnForm: "L. Rivera", signatureLabel: "Jul 15", hasAccount: true },
];

export async function getEnrollmentsView(): Promise<EnrollmentsView> {
  await getDirectorContext();
  return { enrollments: SAMPLE, isSample: true };
}
