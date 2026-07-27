// Shared client-side plumbing for the apply funnel pages.
//
// The apply pages carry NO question list of their own. Every question the parent
// and the student answer comes from the DIRECTOR-PUBLISHED form definition that
// the Stage-2 endpoints return alongside the draft, and the backend accepts
// exactly the student keys that definition publishes. That is what keeps the
// director's editor and the applicant's form in sync in both directions.

/** The question shape as the published definition carries it. */
export interface FormQuestionLike {
  key: string;
  label: string;
  type:
    | "short_text"
    | "long_text"
    | "email"
    | "phone"
    | "date"
    | "dropdown"
    | "multiple_choice"
    | "checkboxes"
    | "consent";
  required: boolean;
  help?: string;
  options?: string[];
}

export interface FormSectionLike {
  id: "parent" | "student";
  title?: string;
  description?: string;
  questions: FormQuestionLike[];
}

/** The resolved published form the Stage-2 endpoints return. */
export interface FormDefinitionLike {
  formId?: string;
  version?: number;
  definition?: { sections?: FormSectionLike[] };
}

export interface ApiResult {
  status: number
  body: Record<string, unknown>
}

/** POST a JSON body; malformed/failed responses become a synthetic status. */
export async function postJson(path: string, payload: unknown): Promise<ApiResult> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return { status: res.status, body }
  } catch {
    return { status: 0, body: {} }
  }
}

/** Friendly copy per API status - never surface raw error bodies. */
export function errorCopy(status: number): string {
  switch (status) {
    case 400:
      return "Something in the form needs another look - please check the fields and try again."
    case 401:
      return "This link is no longer valid - it may have expired or been replaced by a newer one."
    case 409:
      return "This step isn't available right now - the application may have already moved forward."
    case 403:
    case 404:
      return "We couldn't find that. Double-check your link."
    default:
      return "Something went wrong on our end. Please try again in a moment."
  }
}

/**
 * Fallback labels for the 2A facts, used by the 2C review ONLY for a saved answer
 * whose question is no longer on the published form (a director removed it after
 * the parent answered). The published definition supplies every label otherwise.
 */
export const PARENT_FIELD_LABELS: Readonly<Record<string, string>> = {
  childName: 'Student name',
  childDob: 'Date of birth',
  gradeEntering: 'Grade entering in the fall',
  schoolName: 'School',
  guardianName: 'Parent / guardian',
  guardianEmail: 'Guardian email',
  guardianPhone: 'Phone',
  relationship: 'Relationship to student',
  secondGuardianName: 'Second guardian',
  secondGuardianEmail: 'Second guardian email',
  saturdayAvailability: 'Saturday availability confirmed',
  commitmentAcknowledged: 'Commitment acknowledged',
  scholarshipInterest: 'Scholarship info requested',
  attestedGuardian: 'Attested parent/guardian',
  contactConsent: 'Consented to be contacted',
}

/** sessionStorage keys for smoothing the same-device flow (best-effort only). */
export const SS_LEAD_EMAIL = 'curiolab.apply.leadEmail'

export function studentLinkUrl(studentToken: string): string {
  return `${window.location.origin}/apply/student/${studentToken}`
}
