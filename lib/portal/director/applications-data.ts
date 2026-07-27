import { getDirectorContext } from "./session";

export type ApplicationStatus = "interested" | "submitted" | "screening" | "interview" | "accepted" | "declined";

export interface ApplicationRow {
  applicationId: string;
  status: ApplicationStatus;
  studentName: string;
  gradeLevel: string | null;
  termName: string | null;
  submittedLabel: string;
  /** Formatted effective time of the row's current status (from the backend statusDate). */
  statusDateLabel: string;
  // Always populated: the list is always full view now.
  guardianName?: string | null;
  school?: string | null;
  contactEmail?: string | null;
  fillerRole?: "parent" | "student" | null;
  isLead?: boolean;
  duplicateFlag?: boolean;
}

export interface ApplicationDetail {
  applicationId: string;
  status: ApplicationStatus;
  studentName: string;
  gradeLevel: string | null;
  school: string | null;
  contactEmail: string | null;
  guardianName: string;
  guardianEmail: string | null;
  termId: string | null;
  termName: string | null;
  submittedLabel: string;
  answers: { question: string; answer: string }[];
  interview?: { at: string; location: string | null } | null;
  history: { at: string; note: string }[];
  duplicate: {
    flagged: boolean;
    ofApplicationId: string | null;
    ofApplicantName: string | null;
    clearedAt: string | null;
  } | null;
}

export interface TermOption {
  termId: string;
  name: string;
}

/**
 * How a director-facing read turned out. The applications surfaces used to
 * collapse "you are not signed in" and "the backend call failed" into a single
 * fallback that served FABRICATED applicants (Ari Okafor and friends) behind a
 * small banner. A director glancing at that page saw invented children presented
 * as real applications. The two cases are now distinct and neither invents data:
 *
 *   ok              — live data, render it.
 *   unauthenticated — no director session; the page sends them to log in.
 *   error           — the ops call failed; the page says so and offers a retry.
 */
export type ViewState = "ok" | "unauthenticated" | "error";

export interface ApplicationsView {
  applications: ApplicationRow[];
  /** The term the backend filtered to (most-recent by default, or the one requested); null when showing all terms. */
  activeTermId: string | null;
  activeTermName: string | null;
  state: ViewState;
}


function fmt(d: string | undefined | null): string { if (!d) return "—"; const t = new Date(d); return isNaN(t.getTime()) ? "—" : t.toLocaleDateString(); }

/** Grade values arrive as the raw funnel answer ("8", "9th", "Grade 6"…). Prefix bare numbers. */
export function gradeLabel(g: string | null | undefined): string | null {
  if (g == null) return null;
  const t = String(g).trim();
  if (!t) return null;
  return /^\d+$/.test(t) ? `Grade ${t}` : t;
}

/** Funnel answer blobs are keyed by machine field names; turn them into readable questions. */
function humanizeKey(k: string): string {
  return k
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

function mapAppStatus(s: string | undefined): ApplicationStatus {
  if (s === "interested") return "interested";
  if (s === "screening") return "screening";
  if (s === "interview" || s === "interview_scheduled") return "interview";
  if (s === "accepted" || s === "enrolled") return "accepted";
  if (s === "declined" || s === "withdrawn") return "declined";
  return "submitted";
}
function flatten(blob: unknown): { question: string; answer: string }[] {
  if (!blob || typeof blob !== "object") return [];
  return Object.entries(blob as Record<string, unknown>).map(([k, v]) => ({
    question: humanizeKey(k),
    answer: typeof v === "string" ? v : JSON.stringify(v),
  }));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function formatAnswerValue(raw: unknown): string {
  if (Array.isArray(raw)) return raw.map((x) => String(x)).join(", ");
  if (typeof raw === "boolean") return raw ? "Yes" : "No";
  return String(raw);
}

/**
 * Render the submitted answers against the STAMPED form definition (the exact
 * questions/labels the applicant saw), in form order, instead of prettifying raw
 * keys. Parent answers come from stage2a, student answers from stage2b. Returns
 * null when the definition is absent/malformed so the caller can fall back.
 */
function renderAgainstDefinition(definition: unknown, stage2a: unknown, stage2b: unknown): { question: string; answer: string }[] | null {
  if (!isRecord(definition) || !Array.isArray(definition.sections)) return null;
  const parent = isRecord(stage2a) ? stage2a : {};
  const student = isRecord(stage2b) ? stage2b : {};
  const out: { question: string; answer: string }[] = [];
  for (const section of definition.sections) {
    if (!isRecord(section) || !Array.isArray(section.questions)) continue;
    const blob = section.id === "student" ? student : parent;
    for (const q of section.questions) {
      if (!isRecord(q) || typeof q.key !== "string") continue;
      const raw = blob[q.key];
      if (raw === undefined || raw === null || raw === "" || (Array.isArray(raw) && raw.length === 0)) continue;
      const label = typeof q.label === "string" && q.label.trim() ? q.label : humanizeKey(q.key);
      out.push({ question: label, answer: formatAnswerValue(raw) });
    }
  }
  return out;
}

/** The empty result for a read that could not produce live data. */
function emptyView(state: ViewState): ApplicationsView {
  return { applications: [], activeTermId: null, activeTermName: null, state };
}

// ---- live reads -----------------------------------------------------------

interface LiveListItem {
  applicationId?: string;
  status?: string;
  studentName?: string | null;
  gradeLevel?: string | null;
  submittedAt?: string;
  statusDate?: string;
  termName?: string | null;
  guardianName?: string | null;
  school?: string | null;
  contactEmail?: string | null;
  fillerRole?: "parent" | "student" | null;
  isLead?: boolean;
  duplicateFlag?: boolean;
}
interface LiveListEnvelope {
  items?: LiveListItem[];
  activeTermId?: string | null;
  activeTermName?: string | null;
}

/** The term filter options. An empty list simply hides the filter; it never invents terms. */
export async function getTerms(): Promise<{ terms: TermOption[]; state: ViewState }> {
  const ctx = await getDirectorContext();
  if (!ctx) return { terms: [], state: "unauthenticated" };
  try {
    const res = await fetch(`${ctx.origin}/api/ops/terms`, { headers: { cookie: ctx.cookie }, cache: "no-store" });
    if (!res.ok) {
      console.error(`[portal/applications] GET /api/ops/terms failed: ${res.status}`);
      return { terms: [], state: "error" };
    }
    const data = (await res.json()) as { items?: { termId?: string; name?: string }[] };
    const terms = (data.items ?? []).map((t, i) => ({ termId: t.termId ?? `term${i}`, name: t.name ?? "—" }));
    return { terms, state: "ok" };
  } catch (err) {
    console.error("[portal/applications] GET /api/ops/terms threw:", err);
    return { terms: [], state: "error" };
  }
}

export async function getApplicationsView(opts?: { termId?: string }): Promise<ApplicationsView> {
  const termId = opts?.termId;
  const ctx = await getDirectorContext();
  if (!ctx) return emptyView("unauthenticated");
  try {
    // No termId → backend defaults to the most-recent term. ?termId=all shows every term.
    const params = new URLSearchParams();
    if (termId) params.set("termId", termId);
    params.set("view", "full");
    const qs = params.toString() ? `?${params.toString()}` : "";
    const res = await fetch(`${ctx.origin}/api/ops/applications${qs}`, { headers: { cookie: ctx.cookie }, cache: "no-store" });
    if (!res.ok) {
      console.error(`[portal/applications] GET /api/ops/applications failed: ${res.status}`);
      return emptyView("error");
    }
    const data = (await res.json()) as LiveListEnvelope;
    const applications: ApplicationRow[] = (data.items ?? []).map((a, i) => ({
      applicationId: a.applicationId ?? `app${i}`,
      status: mapAppStatus(a.status),
      studentName: a.studentName ?? "—",
      gradeLevel: a.gradeLevel ?? null,
      termName: a.termName ?? null,
      submittedLabel: fmt(a.submittedAt),
      statusDateLabel: fmt(a.statusDate),
      guardianName: a.guardianName ?? null,
      school: a.school ?? null,
      contactEmail: a.contactEmail ?? null,
      fillerRole: a.fillerRole ?? null,
      isLead: a.isLead ?? false,
      duplicateFlag: a.duplicateFlag ?? false,
    }));
    return {
      applications,
      activeTermId: data.activeTermId ?? null,
      activeTermName: data.activeTermName ?? null,
      state: "ok",
    };
  } catch (err) {
    console.error("[portal/applications] GET /api/ops/applications threw:", err);
    return emptyView("error");
  }
}

interface LiveDetail {
  applicationId?: string;
  status?: string;
  submittedAt?: string;
  termId?: string | null;
  termName?: string | null;
  student?: { fullName?: string | null; gradeLevel?: string | null; school?: string | null; contactEmail?: string | null };
  guardian?: { fullName?: string | null; email?: string | null };
  answers?: { stage2a?: unknown; stage2b?: unknown; stage2c?: unknown };
  /** The stamped form version the applicant saw; answers render against this. Null for legacy apps. */
  form?: { formId?: string; version?: number; definition?: unknown } | null;
  interview?: { at?: string | null; location?: string | null } | null;
  history?: { from?: string | null; to?: string; at?: string; note?: string | null }[];
  duplicate?: {
    flagged?: boolean;
    ofApplicationId?: string | null;
    ofApplicantName?: string | null;
    clearedAt?: string | null;
  };
}

export async function getApplicationDetail(
  id: string,
): Promise<{ detail: ApplicationDetail | null; state: ViewState }> {
  const ctx = await getDirectorContext();
  if (!ctx) return { detail: null, state: "unauthenticated" };
  {
    try {
      const res = await fetch(`${ctx.origin}/api/ops/applications/${id}`, { headers: { cookie: ctx.cookie }, cache: "no-store" });
      if (res.ok) {
        const d = (await res.json()) as LiveDetail;
        const detail: ApplicationDetail = {
          applicationId: d.applicationId ?? id,
          status: mapAppStatus(d.status),
          studentName: d.student?.fullName ?? "—",
          gradeLevel: d.student?.gradeLevel ?? null,
          school: d.student?.school ?? null,
          contactEmail: d.student?.contactEmail ?? null,
          guardianName: d.guardian?.fullName ?? "—",
          guardianEmail: d.guardian?.email ?? null,
          termId: d.termId ?? null,
          termName: d.termName ?? null,
          submittedLabel: fmt(d.submittedAt),
          // Render against the stamped form definition; fall back to raw-key humanizing for legacy apps.
          answers:
            renderAgainstDefinition(d.form?.definition, d.answers?.stage2a, d.answers?.stage2b) ??
            [...flatten(d.answers?.stage2a), ...flatten(d.answers?.stage2b)],
          interview: d.interview?.at ? { at: fmt(d.interview.at), location: d.interview.location ?? null } : null,
          history: (d.history ?? []).map((h) => ({ at: fmt(h.at), note: h.note ?? `${h.from ?? "—"} → ${h.to ?? "—"}` })),
          duplicate: d.duplicate
            ? {
                flagged: Boolean(d.duplicate.flagged),
                ofApplicationId: d.duplicate.ofApplicationId ?? null,
                ofApplicantName: d.duplicate.ofApplicantName ?? null,
                clearedAt: d.duplicate.clearedAt ?? null,
              }
            : null,
        };
        return { detail, state: "ok" };
      }
      // A 404 is a real answer (no such application in this chapter), not a
      // failure to load — the page distinguishes it from a broken backend.
      if (res.status === 404) return { detail: null, state: "ok" };
      console.error(`[portal/applications] GET /api/ops/applications/${id} failed: ${res.status}`);
    } catch (err) {
      console.error(`[portal/applications] GET /api/ops/applications/${id} threw:`, err);
    }
  }
  return { detail: null, state: "error" };
}
