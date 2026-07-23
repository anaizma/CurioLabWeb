// Shared client-side plumbing for the apply funnel pages.
// The 2B question set MUST stay within the backend allowlist
// (packages/app/src/config.ts STAGE2_STUDENT_ALLOWED_FIELDS).

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

/** The 2B student questions. Keys MUST be on the backend allowlist. */
export const STUDENT_QUESTIONS: ReadonlyArray<{
  key: string
  label: string
  optional?: boolean
}> = [
  { key: 'interests', label: "What do you like doing when you're not in school?" },
  { key: 'motivation', label: 'Why do you want to join CurioLab?' },
  {
    key: 'favorite_subject',
    label: "What's something you're curious about right now - in school or outside it?",
  },
  {
    key: 'project_idea',
    label:
      "Is there a problem you've noticed at school, in your neighborhood, or in your community that you wish someone would fix?",
  },
  {
    key: 'goals',
    label: 'What do you hope to learn or make by the end of your first semester?',
  },
  {
    key: 'prior_experience',
    label: 'Have you done any coding, building, or making before?',
    optional: true,
  },
]

/** Labels for the 2A facts, used by the 2C read-only review. */
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
