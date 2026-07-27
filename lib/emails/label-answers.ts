// Label a saved answer blob against the form definition that was stamped on the
// application. Shared by the submitted-application email so the copy a director
// receives reads exactly like the portal's view of the same application.
//
// Driven by the ANSWER blob rather than the question list, so an answer whose
// question was later removed from the form is still reported instead of silently
// vanishing — the whole point of this record is that it loses nothing.

export interface LabelledAnswer {
  question: string;
  answer: string;
}

interface QuestionLike {
  key?: unknown;
  label?: unknown;
}
interface SectionLike {
  id?: unknown;
  questions?: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function humanizeKey(k: string): string {
  return k
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

function displayValue(v: unknown): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  return String(v);
}

function hasValue(v: unknown): boolean {
  if (v === undefined || v === null || v === "") return false;
  if (Array.isArray(v)) return v.length === 0 ? false : true;
  return true;
}

/**
 * Every answered key in `blob`, labelled by the matching question in the
 * definition's `sectionId` section and ordered as the form ordered them. Keys the
 * definition does not know about are kept and given a humanized label.
 *
 * `skipKeys` drops convenience duplicates (childName / guardianName are written
 * alongside the split first/last fields and would otherwise appear twice).
 */
export function labelAnswers(
  definition: unknown,
  sectionId: "parent" | "student",
  blob: unknown,
  skipKeys: readonly string[] = [],
): LabelledAnswer[] {
  const answers = isRecord(blob) ? blob : {};
  const sections =
    isRecord(definition) && Array.isArray(definition.sections)
      ? (definition.sections as SectionLike[])
      : [];
  const section = sections.find((s) => s.id === sectionId);
  const questions: QuestionLike[] = Array.isArray(section?.questions)
    ? (section.questions as QuestionLike[])
    : [];

  const order = new Map<string, number>();
  const labels = new Map<string, string>();
  questions.forEach((q, i) => {
    if (typeof q.key !== "string") return;
    order.set(q.key, i);
    if (typeof q.label === "string" && q.label.trim()) labels.set(q.key, q.label);
  });

  return Object.keys(answers)
    .filter((k) => hasValue(answers[k]) && !skipKeys.includes(k))
    .sort(
      (a, b) =>
        (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER),
    )
    .map((k) => ({
      question: labels.get(k) ?? humanizeKey(k),
      answer: displayValue(answers[k]),
    }));
}

/** The combined-name keys the parent client dual-writes alongside the split fields. */
export const DUPLICATE_PARENT_KEYS = ["childName", "guardianName"] as const;
