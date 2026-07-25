import { cookies, headers } from "next/headers";

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

async function originAndCookie(): Promise<{ origin: string; cookie: string } | null> {
  const session = (await cookies()).get("cl_session");
  if (!session) return null;
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? (host ? `${proto}://${host}` : "");
  if (!origin) return null;
  return { origin, cookie: `cl_session=${session.value}` };
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

// ---- representative values -------------------------------------------------

const GUARDIAN_EMAIL = "jordan.okafor@example.com";

/** Representative email model that mirrors the endpoint's rules by age. */
function representativeEmail(age: number): NotificationEmailModel {
  if (age < 13) {
    return { primary: { email: GUARDIAN_EMAIL, isOwn: false, editable: false }, secondary: { email: null, editable: false } };
  }
  return { primary: { email: "ari.okafor@example.com", isOwn: true, editable: true }, secondary: { email: GUARDIAN_EMAIL, editable: false } };
}

function studentView(age: number, email: NotificationEmailModel, emailLive: boolean): MyInfoView {
  return {
    role: "student",
    displayName: "Ari Okafor",
    age,
    emailLive,
    isSample: true,
    notificationEmail: email,
    sections: [
      {
        title: "Identity",
        fields: [
          { key: "fullName", label: "Full name", value: "Ari Okafor", editable: false },
          { key: "dob", label: "Date of birth", value: "September 14, 2013", editable: false },
          { key: "age", label: "Age", value: `${age}`, editable: false, note: "Calculated from your date of birth." },
        ],
      },
      {
        title: "Guardian",
        fields: [
          { key: "guardianName", label: "Guardian", value: "Jordan Okafor", editable: false },
          { key: "guardianEmail", label: "Guardian email", value: GUARDIAN_EMAIL, editable: false },
        ],
      },
      {
        title: "School",
        fields: [
          { key: "school", label: "School", value: "Lincoln Middle School", editable: true, kind: "text" },
          { key: "grade", label: "Grade", value: "8", editable: false },
        ],
      },
    ],
  };
}

function guardianView(): MyInfoView {
  return {
    role: "parent",
    displayName: "Jordan Okafor",
    age: null,
    emailLive: false,
    isSample: true,
    sections: [
      { title: "Identity", fields: [{ key: "fullName", label: "Full name", value: "Jordan Okafor", editable: false }] },
      {
        title: "Contact",
        fields: [
          { key: "email", label: "Email", value: GUARDIAN_EMAIL, editable: true, kind: "email" },
          { key: "phone", label: "Phone", value: "(216) 555-0143", editable: false },
        ],
      },
      {
        title: "Family",
        fields: [
          { key: "children", label: "Students", value: "Ari Okafor", editable: false },
          { key: "relationship", label: "Relationship", value: "Parent", editable: false },
        ],
      },
    ],
  };
}

function directorView(): MyInfoView {
  return {
    role: "director",
    displayName: "Amara Okoro",
    age: null,
    emailLive: false,
    isSample: true,
    sections: [
      { title: "Identity", fields: [{ key: "fullName", label: "Full name", value: "Amara Okoro", editable: false }] },
      { title: "Contact", fields: [{ key: "email", label: "Email", value: "a.okoro@acuriolab.org", editable: true, kind: "email" }] },
      {
        title: "Role",
        fields: [
          { key: "role", label: "Role", value: "Chapter Director", editable: false },
          { key: "chapter", label: "Chapter", value: "Cleveland", editable: false },
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
  return studentView(age, representativeEmail(age), false);
}
