import { originAndCookie } from "@/lib/internal-origin";

// ---------------------------------------------------------------------------
// "My Information" data seam.
//
// The student email pair (primary/secondary) is now LIVE via
// GET/PUT /api/portal/student/notification-email. Everything else (name, DOB,
// school, guardian info, plus parent/director fields) has no self-read endpoint
// yet, so it stays representative — same pattern as guardian-data.ts.
// ---------------------------------------------------------------------------

export type PortalRole = "student" | "parent" | "director";

export interface InfoField {
  key: string;
  label: string;
  value: string;
  /** Editable in the UI. Only email (parent/director) and student school are editable here. */
  editable: boolean;
  kind?: "email" | "text";
  frozen?: boolean;
  note?: string;
}

export interface InfoSection {
  title: string;
  fields: InfoField[];
}

/** The live read model from GET /api/portal/student/notification-email. */
export interface NotificationEmailModel {
  primary: { email: string | null; isOwn: boolean; editable: boolean };
  secondary: { email: string | null; editable: boolean };
}

export interface MyInfoView {
  role: PortalRole;
  displayName: string;
  age: number | null;
  sections: InfoSection[];
  /** Student only: the live (or representative) notification-email pair. */
  notificationEmail?: NotificationEmailModel;
  /** True when notificationEmail came from the real endpoint (not representative). */
  emailLive: boolean;
  /** True when the non-email fields are representative (no self-read endpoint yet). */
  isSample: boolean;
}

async function getSessionAge(): Promise<number | null> {
  try {
    const ctx = await originAndCookie();
    if (!ctx) return null;
    const res = await fetch(`${ctx.origin}/api/auth/session`, { headers: { cookie: ctx.cookie }, cache: "no-store" });
    if (!res.ok) return null;
    const s = (await res.json()) as { age?: number };
    return typeof s.age === "number" ? s.age : null;
  } catch {
    return null;
  }
}

async function fetchNotificationEmail(): Promise<NotificationEmailModel | null> {
  try {
    const ctx = await originAndCookie();
    if (!ctx) return null;
    const res = await fetch(`${ctx.origin}/api/portal/student/notification-email`, { headers: { cookie: ctx.cookie }, cache: "no-store" });
    if (!res.ok) return null;
    const d = (await res.json()) as { primary?: { email?: string | null; isOwn?: boolean; editable?: boolean }; secondary?: { email?: string | null } };
    if (!d.primary) return null;
    return {
      primary: { email: d.primary.email ?? null, isOwn: !!d.primary.isOwn, editable: !!d.primary.editable },
      secondary: { email: d.secondary?.email ?? null, editable: false },
    };
  } catch {
    return null;
  }
}

// ---- empty views -----------------------------------------------------------
//
// These used to return an invented identity per role — a student "Ari Okafor"
// with a date of birth, school and guardian; a parent "Jordan Okafor" with a
// phone number; a director "Amara Okoro" at a made-up address on the real
// acuriolab.org domain. On a settings page headed "My information" that is
// actively misleading: every value reads as the signed-in person's own record,
// and one of them looked like a real staff mailbox.
//
// Nothing is invented now. Fields render blank behind SampleBanner until the
// per-role read endpoints are wired.

const EMPTY_VALUE = "";

/** The empty email model; the live endpoint fills this when it is wired. */
function representativeEmail(): NotificationEmailModel {
  return {
    primary: { email: null, isOwn: false, editable: false },
    secondary: { email: null, editable: false },
  };
}

function studentView(age: number, email: NotificationEmailModel, emailLive: boolean): MyInfoView {
  return {
    role: "student",
    displayName: EMPTY_VALUE,
    age,
    emailLive,
    isSample: true,
    notificationEmail: email,
    sections: [
      {
        title: "Identity",
        fields: [
          { key: "fullName", label: "Full name", value: EMPTY_VALUE, editable: false },
          { key: "dob", label: "Date of birth", value: EMPTY_VALUE, editable: false },
          { key: "age", label: "Age", value: EMPTY_VALUE, editable: false, note: "Calculated from your date of birth." },
        ],
      },
      {
        title: "Guardian",
        fields: [
          { key: "guardianName", label: "Guardian", value: EMPTY_VALUE, editable: false },
          { key: "guardianEmail", label: "Guardian email", value: EMPTY_VALUE, editable: false },
        ],
      },
      {
        title: "School",
        fields: [
          { key: "school", label: "School", value: EMPTY_VALUE, editable: true, kind: "text" },
          { key: "grade", label: "Grade", value: EMPTY_VALUE, editable: false },
        ],
      },
    ],
  };
}

function guardianView(): MyInfoView {
  return {
    role: "parent",
    displayName: EMPTY_VALUE,
    age: null,
    emailLive: false,
    isSample: true,
    sections: [
      { title: "Identity", fields: [{ key: "fullName", label: "Full name", value: EMPTY_VALUE, editable: false }] },
      {
        title: "Contact",
        fields: [
          { key: "email", label: "Email", value: EMPTY_VALUE, editable: true, kind: "email" },
          { key: "phone", label: "Phone", value: EMPTY_VALUE, editable: false },
        ],
      },
      {
        title: "Family",
        fields: [
          { key: "children", label: "Students", value: EMPTY_VALUE, editable: false },
          { key: "relationship", label: "Relationship", value: EMPTY_VALUE, editable: false },
        ],
      },
    ],
  };
}

function directorView(): MyInfoView {
  return {
    role: "director",
    displayName: EMPTY_VALUE,
    age: null,
    emailLive: false,
    isSample: true,
    sections: [
      { title: "Identity", fields: [{ key: "fullName", label: "Full name", value: EMPTY_VALUE, editable: false }] },
      { title: "Contact", fields: [{ key: "email", label: "Email", value: EMPTY_VALUE, editable: true, kind: "email" }] },
      {
        title: "Role",
        fields: [
          { key: "role", label: "Role", value: EMPTY_VALUE, editable: false },
          { key: "chapter", label: "Chapter", value: EMPTY_VALUE, editable: false },
        ],
      },
    ],
  };
}

export async function getMyInformation(role: PortalRole): Promise<MyInfoView> {
  if (role === "parent") return guardianView();
  if (role === "director") return directorView();
  // Student: wire the email pair to the live endpoint; fall back to a
  // representative model (by real session age, else under-13) when unauthenticated.
  const age = (await getSessionAge()) ?? 12;
  const live = await fetchNotificationEmail();
  if (live) return studentView(age, live, true);
  return studentView(age, representativeEmail(), false);
}
