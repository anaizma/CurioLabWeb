import { getDirectorContext } from "./session";

// ---------------------------------------------------------------------------
// Director-portal "Consent Forms" read data (Phase 1, READ-ONLY).
//
// Mirrors media-data.ts: a server-only helper that fetches the consent catalog
// with the director's session cookie, falling back to representative SAMPLE data
// when the request is unauthenticated (the /portal preview). Types are defined
// LOCALLY here (client-safe) — @curiolab/app is never imported into a module the
// client bundle may reach.
// ---------------------------------------------------------------------------

export type FormAudience = "guardian" | "mentor" | "student";
export type FieldInputType = "text" | "date" | "tel" | "email";
/** The detail-field input types a director may pick (adds `signature`). */
export type EditableFieldInputType = "text" | "date" | "tel" | "email" | "signature";

/** The grant types a checkbox item may map to (mirrors ConsentGrantType). */
export const GRANT_MAPPINGS = [
  "program_participation",
  "platform_account",
  "public_publication",
  "photo_video_likeness",
  "emergency_medical_pickup",
  "verification_link_sharing",
  "mentor_dm",
  "student_notification_email",
] as const;
export type GrantMapping = (typeof GRANT_MAPPINGS)[number];

export const AUDIENCES: FormAudience[] = ["guardian", "mentor", "student"];
export const AUDIENCE_LABELS: Record<FormAudience, string> = {
  guardian: "Guardian",
  mentor: "Mentor",
  student: "Student",
};

/** One row in the grouped consent-form list. */
export interface DirectorFormSummary {
  formKey: string;
  audience: FormAudience;
  title: string;
  documentId: string;
  version: string;
  elevated: boolean;
  itemCount: number;
  fieldCount: number;
  pdfPath: string;
}

/** One checkbox clause (director-facing: includes the grant mapping). */
export interface DirectorFormItem {
  itemKey: string;
  text: string;
  required: boolean;
  elevated: boolean;
  grantMapping?: string | null;
}

/** One fill-in blank on the form. */
export interface DirectorFormField {
  fieldType: string;
  label: string;
  inputType: FieldInputType;
  required: boolean;
}

/** The full detail of one consent form. */
export interface DirectorFormDetail {
  formKey: string;
  audience: FormAudience;
  title: string;
  documentId: string;
  version: string;
  elevated: boolean;
  pdfPath: string;
  items: DirectorFormItem[];
  fields: DirectorFormField[];
}

// ---- editable definition (Phase 2b editor) --------------------------------

/** One editable checkbox clause. */
export interface EditableItem {
  itemKey: string;
  text: string;
  required: boolean;
  elevated: boolean;
  grantMapping?: string | null;
}

/** One editable detail field. `fixed:true` marks a locked default (not removable). */
export interface EditableField {
  fieldType: string;
  label: string;
  inputType: EditableFieldInputType;
  required: boolean;
  fixed?: boolean;
}

/** The CURRENT definition loaded into the editor (draft or published, else catalog). */
export interface EditableConsentForm {
  formKey: string;
  audience: FormAudience;
  title: string;
  documentId: string;
  elevated: boolean;
  items: EditableItem[];
  fields: EditableField[];
  pdfUrl: string;
  version: number;
  status: "draft" | "published";
  hasDraft: boolean;
}

/**
 * The locked default detail fields per audience — hardcoded to match the backend
 * (ConsentFormAdminService.LOCKED_FIELDS). A director may ADD fields but not
 * remove these. Client-safe (no server imports) so the editor page can seed a
 * create template and the client editor can swap defaults on audience change.
 */
export const LOCKED_FIELDS: Record<FormAudience, readonly EditableField[]> = {
  guardian: [
    { fieldType: "guardian_name", label: "Guardian name", inputType: "text", required: true, fixed: true },
    { fieldType: "relationship", label: "Relationship to child", inputType: "text", required: true, fixed: true },
    { fieldType: "date", label: "Date", inputType: "date", required: true, fixed: true },
    { fieldType: "signature", label: "Signature", inputType: "signature", required: true, fixed: true },
  ],
  mentor: [
    { fieldType: "mentor_name", label: "Mentor name", inputType: "text", required: true, fixed: true },
    { fieldType: "date", label: "Date", inputType: "date", required: true, fixed: true },
    { fieldType: "signature", label: "Signature", inputType: "signature", required: true, fixed: true },
  ],
  student: [
    { fieldType: "student_name", label: "Student name", inputType: "text", required: true, fixed: true },
    { fieldType: "date", label: "Date", inputType: "date", required: true, fixed: true },
    { fieldType: "signature", label: "Signature", inputType: "signature", required: true, fixed: true },
  ],
};

/** The locked default fields for an audience (a fresh copy each call). */
export function lockedFieldsFor(audience: FormAudience): EditableField[] {
  return (LOCKED_FIELDS[audience] ?? []).map((f) => ({ ...f }));
}

/** A blank editable form for the "new consent form" flow. */
export function emptyEditableFor(audience: FormAudience): EditableConsentForm {
  return {
    formKey: "",
    audience,
    title: "",
    documentId: "",
    elevated: false,
    items: [],
    fields: lockedFieldsFor(audience),
    pdfUrl: "",
    version: 0,
    status: "draft",
    hasDraft: false,
  };
}

// ---- representative sample (unauthenticated preview) ----------------------
// Metadata mirrors the live @curiolab/app CATALOG. Item/field text is
// representative, not the exact legal wording (the live read supplies that).

const SAMPLE_FORMS: DirectorFormSummary[] = [
  { formKey: "form-01", audience: "guardian", title: "Enrollment and Account Setup", documentId: "CL-CONSENT-01", version: "2026.03", elevated: false, itemCount: 9, fieldCount: 7, pdfPath: "/consent-forms/form-01.pdf" },
  { formKey: "form-02", audience: "guardian", title: "Publishing Your Child’s Work Publicly", documentId: "CL-CONSENT-02", version: "2026.03", elevated: true, itemCount: 7, fieldCount: 3, pdfPath: "/consent-forms/form-02.pdf" },
  { formKey: "form-03", audience: "guardian", title: "Photograph and Video Release", documentId: "CL-CONSENT-03", version: "2026.03", elevated: false, itemCount: 10, fieldCount: 3, pdfPath: "/consent-forms/form-03.pdf" },
  { formKey: "form-04", audience: "guardian", title: "Direct Messages Between Your Child and Their Mentor", documentId: "CL-CONSENT-04", version: "2026.03", elevated: true, itemCount: 3, fieldCount: 3, pdfPath: "/consent-forms/form-04.pdf" },
  { formKey: "form-05", audience: "guardian", title: "Shareable Verification Link Acknowledgment", documentId: "CL-CONSENT-05", version: "2026.03", elevated: false, itemCount: 5, fieldCount: 3, pdfPath: "/consent-forms/form-05.pdf" },
  { formKey: "form-06", audience: "guardian", title: "Emergency Contact and Medical Authorization", documentId: "CL-CONSENT-06", version: "2026.03", elevated: false, itemCount: 4, fieldCount: 5, pdfPath: "/consent-forms/form-06.pdf" },
  { formKey: "form-07", audience: "guardian", title: "Pickup and Release Authorization", documentId: "CL-CONSENT-07", version: "2026.03", elevated: false, itemCount: 3, fieldCount: 3, pdfPath: "/consent-forms/form-07.pdf" },
  { formKey: "form-08", audience: "mentor", title: "Mentor Code of Conduct and Acceptable Use", documentId: "CL-CONSENT-08", version: "2026.03", elevated: false, itemCount: 1, fieldCount: 2, pdfPath: "/consent-forms/form-08.pdf" },
  { formKey: "form-09", audience: "mentor", title: "Background Check Disclosure and Authorization", documentId: "CL-CONSENT-09", version: "2026.03", elevated: false, itemCount: 2, fieldCount: 2, pdfPath: "/consent-forms/form-09.pdf" },
  { formKey: "form-10", audience: "mentor", title: "Volunteer and Role Agreement", documentId: "CL-CONSENT-10", version: "2026.03", elevated: false, itemCount: 1, fieldCount: 2, pdfPath: "/consent-forms/form-10.pdf" },
  { formKey: "form-11", audience: "student", title: "Age of Majority Transfer Acknowledgment", documentId: "CL-CONSENT-11", version: "2026.03", elevated: false, itemCount: 5, fieldCount: 2, pdfPath: "/consent-forms/form-11.pdf" },
];

/** Synthesize a representative detail for the sample (real metadata, generic clause text). */
function sampleDetail(summary: DirectorFormSummary): DirectorFormDetail {
  const items: DirectorFormItem[] = Array.from({ length: summary.itemCount }, (_, i) => ({
    itemKey: `${summary.formKey}:item-${i + 1}`,
    text: `Representative consent clause ${i + 1} for “${summary.title}”. The live view shows the exact wording.`,
    required: true,
    elevated: summary.elevated && i === summary.itemCount - 1,
    grantMapping: null,
  }));
  const fields: DirectorFormField[] = Array.from({ length: summary.fieldCount }, (_, i) => ({
    fieldType: `field_${i + 1}`,
    label: `Detail field ${i + 1}`,
    inputType: "text" as FieldInputType,
    required: true,
  }));
  return { ...summary, items, fields };
}

// ---- live reads -----------------------------------------------------------

interface LiveSummary {
  formKey?: string;
  audience?: string;
  title?: string;
  documentId?: string;
  version?: string;
  elevated?: boolean;
  itemCount?: number;
  fieldCount?: number;
  pdfPath?: string;
}
interface LiveDetail extends LiveSummary {
  items?: { itemKey?: string; text?: string; required?: boolean; elevated?: boolean; grantMapping?: string | null }[];
  fields?: { fieldType?: string; label?: string; inputType?: string; required?: boolean }[];
}

function toAudience(a: string | undefined): FormAudience {
  return a === "mentor" || a === "student" ? a : "guardian";
}
function toInputType(t: string | undefined): FieldInputType {
  return t === "date" || t === "tel" || t === "email" ? t : "text";
}

function toSummary(s: LiveSummary, i: number): DirectorFormSummary {
  return {
    formKey: s.formKey ?? `form-${i}`,
    audience: toAudience(s.audience),
    title: s.title ?? "Untitled form",
    documentId: s.documentId ?? "—",
    version: s.version ?? "—",
    elevated: s.elevated ?? false,
    itemCount: s.itemCount ?? 0,
    fieldCount: s.fieldCount ?? 0,
    pdfPath: s.pdfPath ?? "",
  };
}

export async function getConsentFormsForDirector(): Promise<{ forms: DirectorFormSummary[]; isSample: boolean }> {
  const ctx = await getDirectorContext();
  if (!ctx) return { forms: SAMPLE_FORMS, isSample: true };
  try {
    const res = await fetch(`${ctx.origin}/api/ops/consent-forms`, { headers: { cookie: ctx.cookie }, cache: "no-store" });
    if (!res.ok) return { forms: SAMPLE_FORMS, isSample: true };
    const data = (await res.json()) as { items?: LiveSummary[] };
    const forms = (data.items ?? []).map(toSummary);
    return { forms, isSample: false };
  } catch {
    return { forms: SAMPLE_FORMS, isSample: true };
  }
}

export async function getConsentFormDetailForDirector(key: string): Promise<{ detail: DirectorFormDetail | null; isSample: boolean }> {
  const ctx = await getDirectorContext();
  if (ctx) {
    try {
      const res = await fetch(`${ctx.origin}/api/ops/consent-forms/${encodeURIComponent(key)}`, { headers: { cookie: ctx.cookie }, cache: "no-store" });
      if (res.ok) {
        const d = (await res.json()) as LiveDetail;
        const detail: DirectorFormDetail = {
          ...toSummary(d, 0),
          formKey: d.formKey ?? key,
          items: (d.items ?? []).map((it, i) => ({
            itemKey: it.itemKey ?? `${key}:item-${i + 1}`,
            text: it.text ?? "",
            required: it.required ?? false,
            elevated: it.elevated ?? false,
            grantMapping: it.grantMapping ?? null,
          })),
          fields: (d.fields ?? []).map((f, i) => ({
            fieldType: f.fieldType ?? `field_${i + 1}`,
            label: f.label ?? "—",
            inputType: toInputType(f.inputType),
            required: f.required ?? false,
          })),
        };
        return { detail, isSample: false };
      }
      if (res.status === 404) return { detail: null, isSample: false };
    } catch {
      /* fall through to sample */
    }
  }
  const summary = SAMPLE_FORMS.find((f) => f.formKey === key);
  return { detail: summary ? sampleDetail(summary) : null, isSample: true };
}

// ---- editable read (Phase 2b editor) --------------------------------------

interface LiveEditable {
  formKey?: string;
  audience?: string;
  title?: string;
  documentId?: string;
  elevated?: boolean;
  items?: { itemKey?: string; text?: string; required?: boolean; elevated?: boolean; grantMapping?: string | null }[];
  fields?: { fieldType?: string; label?: string; inputType?: string; required?: boolean; fixed?: boolean }[];
  pdfUrl?: string;
  version?: number;
  status?: string;
  hasDraft?: boolean;
}

function toEditableInputType(t: string | undefined): EditableFieldInputType {
  return t === "date" || t === "tel" || t === "email" || t === "signature" ? t : "text";
}

/** Synthesize a representative editable form for the unauthenticated preview. */
function sampleEditable(key: string): EditableConsentForm | null {
  const summary = SAMPLE_FORMS.find((f) => f.formKey === key);
  if (!summary) return null;
  const detail = sampleDetail(summary);
  return {
    formKey: summary.formKey,
    audience: summary.audience,
    title: summary.title,
    documentId: summary.documentId,
    elevated: summary.elevated,
    items: detail.items.map((it) => ({ ...it })),
    fields: lockedFieldsFor(summary.audience),
    pdfUrl: summary.pdfPath,
    version: 0,
    status: "published",
    hasDraft: false,
  };
}

export async function getEditableConsentForm(
  key: string,
): Promise<{ editable: EditableConsentForm | null; isSample: boolean }> {
  const ctx = await getDirectorContext();
  if (ctx) {
    try {
      const res = await fetch(`${ctx.origin}/api/ops/consent-forms/${encodeURIComponent(key)}/editable`, {
        headers: { cookie: ctx.cookie },
        cache: "no-store",
      });
      if (res.ok) {
        const d = (await res.json()) as LiveEditable;
        const audience = toAudience(d.audience);
        const editable: EditableConsentForm = {
          formKey: d.formKey ?? key,
          audience,
          title: d.title ?? "",
          documentId: d.documentId ?? "",
          elevated: d.elevated ?? false,
          items: (d.items ?? []).map((it, i) => ({
            itemKey: it.itemKey ?? `${key}:item-${i + 1}`,
            text: it.text ?? "",
            required: it.required ?? false,
            elevated: it.elevated ?? false,
            grantMapping: it.grantMapping ?? null,
          })),
          fields: (d.fields ?? []).map((f, i) => ({
            fieldType: f.fieldType ?? `field_${i + 1}`,
            label: f.label ?? "",
            inputType: toEditableInputType(f.inputType),
            required: f.required ?? false,
            fixed: f.fixed ?? false,
          })),
          pdfUrl: d.pdfUrl ?? "",
          version: d.version ?? 0,
          status: d.status === "published" ? "published" : "draft",
          hasDraft: d.hasDraft ?? false,
        };
        return { editable, isSample: false };
      }
      if (res.status === 404) return { editable: null, isSample: false };
    } catch {
      /* fall through to sample */
    }
  }
  return { editable: sampleEditable(key), isSample: true };
}
