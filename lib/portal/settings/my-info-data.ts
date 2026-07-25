import { cookies, headers } from "next/headers";

// ---------------------------------------------------------------------------
// "My Information" data seam.
//
// There is no self-PII read/update endpoint yet (only GET /api/auth/session,
// which exposes the computed `age`). So this returns a representative view for
// now — same pattern as lib/portal/guardian/guardian-data.ts — structured to
// swap onto GET /api/account (read) + PATCH (update) once they land.
//
// The age-13 rule is honored client-side to mirror the COPPA backend: an
// under-13 student has no direct email (they take the guardian's), so the
// primary-email field is frozen to the guardian's address until they turn 13.
// ---------------------------------------------------------------------------

export type PortalRole = "student" | "parent" | "director";

export interface InfoField {
  key: string;
  label: string;
  value: string;
  /** Editable in the UI. Only email (per role) and student school are ever editable. */
  editable: boolean;
  kind?: "email" | "text";
  /** Frozen editable field (e.g. under-13 primary email); shown locked with a reason. */
  frozen?: boolean;
  note?: string;
}

export interface InfoSection {
  title: string;
  fields: InfoField[];
}

export interface MyInfoView {
  role: PortalRole;
  displayName: string;
  age: number | null;
  sections: InfoSection[];
  /** Values are representative until the account endpoint connects. */
  isSample: boolean;
}

async function getSessionAge(): Promise<number | null> {
  try {
    const session = (await cookies()).get("cl_session");
    if (!session) return null;
    const h = await headers();
    const host = h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "http";
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? (host ? `${proto}://${host}` : "");
    if (!origin) return null;
    const res = await fetch(`${origin}/api/auth/session`, { headers: { cookie: `cl_session=${session.value}` }, cache: "no-store" });
    if (!res.ok) return null;
    const s = (await res.json()) as { age?: number };
    return typeof s.age === "number" ? s.age : null;
  } catch {
    return null;
  }
}

// ---- representative values -------------------------------------------------

const GUARDIAN_EMAIL = "jordan.okafor@example.com";

function studentView(age: number): MyInfoView {
  const under13 = age < 13;
  return {
    role: "student",
    displayName: "Ari Okafor",
    age,
    isSample: true,
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
        title: "Contact",
        fields: [
          under13
            ? { key: "email", label: "Primary email", value: GUARDIAN_EMAIL, editable: false, frozen: true, kind: "email", note: "Frozen to your guardian's email until you turn 13. CurioLab reaches you through your guardian." }
            : { key: "email", label: "Primary email", value: "ari.okafor@example.com", editable: true, kind: "email" },
          { key: "secondaryEmail", label: "Secondary email", value: under13 ? "—" : "ari.builds@example.com", editable: false, note: under13 ? "Available once you turn 13." : undefined },
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
  // Student: honor the real age from the session when present so the under-13
  // email freeze is accurate; otherwise a representative under-13 age to show it.
  const age = (await getSessionAge()) ?? 12;
  return studentView(age);
}
