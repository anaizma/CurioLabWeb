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

export async function getApplicationsView(): Promise<ApplicationsView> {
  await getDirectorContext(); // no GET yet; flips to live when GET /api/ops/applications lands
  return {
    applications: SAMPLE.map((a) => ({
      applicationId: a.applicationId,
      status: a.status,
      studentDisplayName: a.studentDisplayName,
      guardianDisplayName: a.guardianDisplayName,
      submittedLabel: a.submittedLabel,
    })),
    isSample: true,
  };
}

export async function getApplicationDetail(id: string): Promise<{ detail: ApplicationDetail | null; isSample: boolean }> {
  await getDirectorContext();
  const detail = SAMPLE.find((a) => a.applicationId === id) ?? SAMPLE[0] ?? null;
  return { detail, isSample: true };
}
