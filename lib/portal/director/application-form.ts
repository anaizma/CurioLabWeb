// ---------------------------------------------------------------------------
// Application-form definition model.
//
// This mirrors the shape a backend form-definition store would hold, so the
// editor can be wired to a real GET/PUT endpoint later with minimal change.
// Today it is seeded from the live hardcoded funnel questions and persisted to
// the director's browser (localStorage) — see docs/platform/application-form-
// definition-spec.md for the end-to-end backend plan.
// ---------------------------------------------------------------------------

export type QuestionType =
  | "short_text"
  | "long_text"
  | "email"
  | "phone"
  | "date"
  | "dropdown"
  | "multiple_choice"
  | "checkboxes"
  | "consent";

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  short_text: "Short answer",
  long_text: "Paragraph",
  email: "Email",
  phone: "Phone",
  date: "Date",
  dropdown: "Dropdown",
  multiple_choice: "Multiple choice",
  checkboxes: "Checkboxes",
  consent: "Consent / acknowledgement",
};

/** Types that carry a list of options the editor can manage. */
export const CHOICE_TYPES: QuestionType[] = ["dropdown", "multiple_choice", "checkboxes"];

export interface FormQuestion {
  id: string;
  /** Machine key written into the answers blob. Student keys must stay on the backend allowlist. */
  key: string;
  label: string;
  type: QuestionType;
  required: boolean;
  help?: string;
  options?: string[];
  /**
   * System-critical field the platform/enrollment depends on. Its key, type and
   * required flag are locked and it cannot be removed — only its wording/help edited.
   */
  fixed?: boolean;
}

export interface FormSection {
  id: "parent" | "student";
  title: string;
  description: string;
  questions: FormQuestion[];
}

export interface ApplicationForm {
  version: number;
  updatedAt: string | null;
  sections: FormSection[];
}

export const STORAGE_KEY = "curiolab.director.applicationForm.v1";

const GRADES = ["6", "7", "8", "9", "10", "11", "12"];
const RELATIONSHIPS = ["Parent", "Legal guardian", "Grandparent", "Foster parent", "Other"];

// Parent (Stage 2A) intake fields — hardcoded in app/apply/parent/[token]/parent-client.tsx.
// Identity + consent fields are marked fixed (the platform/enrollment relies on them).
const PARENT_QUESTIONS: FormQuestion[] = [
  { id: "p_childFirstName", key: "childFirstName", label: "Child first name", type: "short_text", required: true, fixed: true },
  { id: "p_childLastName", key: "childLastName", label: "Child last name", type: "short_text", required: true, fixed: true },
  { id: "p_childDob", key: "childDob", label: "Child date of birth", type: "date", required: true, fixed: true },
  { id: "p_gradeEntering", key: "gradeEntering", label: "Grade entering in the fall", type: "dropdown", required: true, fixed: true, options: [...GRADES] },
  { id: "p_schoolName", key: "schoolName", label: "School", type: "short_text", required: true },
  { id: "p_guardianFirstName", key: "guardianFirstName", label: "Parent / guardian first name", type: "short_text", required: true, fixed: true },
  { id: "p_guardianLastName", key: "guardianLastName", label: "Parent / guardian last name", type: "short_text", required: true, fixed: true },
  { id: "p_guardianEmail", key: "guardianEmail", label: "Guardian email", type: "email", required: true, fixed: true },
  { id: "p_guardianPhone", key: "guardianPhone", label: "Phone", type: "phone", required: true },
  { id: "p_relationship", key: "relationship", label: "Relationship to student", type: "dropdown", required: true, fixed: true, options: [...RELATIONSHIPS] },
  { id: "p_secondGuardianName", key: "secondGuardianName", label: "Second guardian", type: "short_text", required: false },
  { id: "p_secondGuardianEmail", key: "secondGuardianEmail", label: "Second guardian email", type: "email", required: false },
  { id: "p_saturdayAvailability", key: "saturdayAvailability", label: "We can commit to Saturday sessions", type: "consent", required: true, fixed: true },
  { id: "p_commitmentAcknowledged", key: "commitmentAcknowledged", label: "I acknowledge the program commitment", type: "consent", required: true, fixed: true },
  { id: "p_scholarshipInterest", key: "scholarshipInterest", label: "Send me information about scholarships", type: "consent", required: false },
  { id: "p_attestedGuardian", key: "attestedGuardian", label: "I attest I am the parent or legal guardian", type: "consent", required: true, fixed: true },
  { id: "p_contactConsent", key: "contactConsent", label: "I consent to be contacted about this application", type: "consent", required: true, fixed: true },
];

// Student (Stage 2B) questionnaire. This is only the SEED for a chapter that has
// never saved a form; the published definition in the database is what applicants
// actually see and what the backend accepts as 2B keys. A director may reword
// these, remove them, or add their own, subject to one rule enforced at publish:
// a student question may not ask for identifying information.
const STUDENT_QS: FormQuestion[] = [
  { id: "s_interests", key: "interests", label: "What do you like doing when you're not in school?", type: "long_text", required: true },
  { id: "s_motivation", key: "motivation", label: "Why do you want to join CurioLab?", type: "long_text", required: true },
  { id: "s_curiosity", key: "curiosity", label: "What's something you're curious about right now - in school or outside it?", type: "long_text", required: true },
  { id: "s_problem_to_fix", key: "problem_to_fix", label: "Is there a problem you've noticed at school, in your neighborhood, or in your community that you wish someone would fix?", type: "long_text", required: true },
  { id: "s_goals", key: "goals", label: "What do you hope to learn or make by the end of your first semester?", type: "long_text", required: true },
  { id: "s_prior_experience", key: "prior_experience", label: "Have you done any coding, building, or making before?", type: "long_text", required: false },
];

export function defaultForm(): ApplicationForm {
  return {
    version: 1,
    updatedAt: null,
    sections: [
      {
        id: "parent",
        title: "Parent / guardian section",
        description: "Completed by the parent or guardian. Identity and consent fields are required by the platform and can't be removed.",
        questions: PARENT_QUESTIONS.map((q) => ({ ...q })),
      },
      {
        id: "student",
        title: "Student questionnaire",
        description: "Completed by the student. Free-form questions you can add, reword, reorder or remove.",
        questions: STUDENT_QS.map((q) => ({ ...q })),
      },
    ],
  };
}

/** Turn a question label into a slug key for newly-added questions. */
export function slugKey(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return base || "question";
}
