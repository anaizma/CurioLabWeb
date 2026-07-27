"use client";

// Renders a section of the DIRECTOR-PUBLISHED application form.
//
// This is the piece that makes the two ends agree. The apply pages used to carry
// their own hardcoded question lists, so a director editing the form in the portal
// changed only how answers were LABELLED in their own read view — applicants kept
// seeing the old questions, and any question the director removed silently
// vanished from the director's view of answers that had already been given. Both
// pages now render from the same published definition the backend stamps onto the
// draft and validates 2B writes against.

import type { FormDefinitionLike, FormQuestionLike } from "./funnel";

export type AnswerValue = string | boolean | string[];
export type AnswerMap = Record<string, AnswerValue>;

/** The empty value that matches a question's type. */
export function emptyFor(q: FormQuestionLike): AnswerValue {
  if (q.type === "consent") return false;
  if (q.type === "checkboxes") return [];
  return "";
}

/** True when a required question has not been answered. */
export function isBlank(q: FormQuestionLike, v: AnswerValue | undefined): boolean {
  if (v === undefined) return true;
  if (typeof v === "boolean") return v === false;
  if (Array.isArray(v)) return v.length === 0;
  return v.trim() === "";
}

/** The first required question left unanswered, or null when the section is complete. */
export function firstMissingRequired(
  questions: readonly FormQuestionLike[],
  answers: AnswerMap,
): FormQuestionLike | null {
  return questions.find((q) => q.required && isBlank(q, answers[q.key])) ?? null;
}

/** Seed an answer map for a section, preferring saved values over empties. */
export function seedAnswers(
  questions: readonly FormQuestionLike[],
  saved: Record<string, unknown> | undefined,
): AnswerMap {
  const out: AnswerMap = {};
  for (const q of questions) {
    const v = saved?.[q.key];
    if (q.type === "checkboxes") {
      out[q.key] = Array.isArray(v) ? v.map((x) => String(x)) : [];
    } else if (q.type === "consent") {
      out[q.key] = v === true;
    } else {
      out[q.key] = v === undefined || v === null ? "" : String(v);
    }
  }
  return out;
}

/** Pull one section's questions out of a published definition. */
export function questionsOf(
  form: FormDefinitionLike | null | undefined,
  sectionId: "parent" | "student",
): FormQuestionLike[] {
  const section = form?.definition?.sections?.find((s) => s.id === sectionId);
  return section?.questions ?? [];
}

/** The section's title/description as the director worded them. */
export function sectionMeta(
  form: FormDefinitionLike | null | undefined,
  sectionId: "parent" | "student",
): { title: string; description: string } | null {
  const s = form?.definition?.sections?.find((x) => x.id === sectionId);
  if (!s) return null;
  return { title: s.title ?? "", description: s.description ?? "" };
}

const INPUT_CLASS = "w-full border border-black/20 rounded-md px-4 py-3 bg-white";

export default function FormFields({
  questions,
  answers,
  onChange,
  disabled,
}: {
  questions: readonly FormQuestionLike[];
  answers: AnswerMap;
  onChange: (key: string, value: AnswerValue) => void;
  disabled?: boolean;
}) {
  return (
    <>
      {questions.map((q) => {
        const value = answers[q.key] ?? emptyFor(q);

        // A consent question is a single checkbox whose LABEL is the statement,
        // so it reads as a sentence the parent agrees to rather than a field.
        if (q.type === "consent") {
          return (
            <label key={q.key} className="flex items-start gap-3 text-black">
              <input
                type="checkbox"
                className="mt-1"
                required={q.required}
                disabled={disabled}
                checked={value === true}
                onChange={(e) => onChange(q.key, e.target.checked)}
              />
              <span>
                {q.label}
                {q.help ? <span className="block text-xs text-muted mt-1">{q.help}</span> : null}
              </span>
            </label>
          );
        }

        return (
          <div key={q.key}>
            <label className="label block mb-2">
              {q.label}
              {!q.required && <span className="text-muted font-normal"> (optional)</span>}
            </label>
            {q.help && <p className="text-xs text-muted mb-2">{q.help}</p>}

            {q.type === "long_text" && (
              <textarea
                className={INPUT_CLASS}
                rows={4}
                required={q.required}
                disabled={disabled}
                value={String(value)}
                onChange={(e) => onChange(q.key, e.target.value)}
              />
            )}

            {(q.type === "short_text" || q.type === "email" || q.type === "phone" || q.type === "date") && (
              <input
                className={INPUT_CLASS}
                type={q.type === "short_text" ? "text" : q.type === "phone" ? "tel" : q.type}
                required={q.required}
                disabled={disabled}
                value={String(value)}
                onChange={(e) => onChange(q.key, e.target.value)}
              />
            )}

            {q.type === "dropdown" && (
              <select
                className={INPUT_CLASS}
                required={q.required}
                disabled={disabled}
                value={String(value)}
                onChange={(e) => onChange(q.key, e.target.value)}
              >
                <option value="" disabled>
                  Select one
                </option>
                {(q.options ?? []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            )}

            {q.type === "multiple_choice" && (
              <div className="space-y-2">
                {(q.options ?? []).map((opt) => (
                  <label key={opt} className="flex items-center gap-2 text-black">
                    <input
                      type="radio"
                      name={q.key}
                      value={opt}
                      required={q.required}
                      disabled={disabled}
                      checked={value === opt}
                      onChange={() => onChange(q.key, opt)}
                    />
                    {opt}
                  </label>
                ))}
              </div>
            )}

            {q.type === "checkboxes" && (
              <div className="space-y-2">
                {(q.options ?? []).map((opt) => {
                  const selected = Array.isArray(value) ? value : [];
                  return (
                    <label key={opt} className="flex items-center gap-2 text-black">
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={selected.includes(opt)}
                        onChange={(e) =>
                          onChange(
                            q.key,
                            e.target.checked
                              ? [...selected, opt]
                              : selected.filter((x) => x !== opt),
                          )
                        }
                      />
                      {opt}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
