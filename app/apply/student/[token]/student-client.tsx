"use client";

import { useEffect, useRef, useState } from "react";
import { errorCopy, postJson, type FormDefinitionLike } from "../../funnel";
import FormFields, {
  firstMissingRequired,
  questionsOf,
  seedAnswers,
  sectionMeta,
  type AnswerMap,
  type AnswerValue,
} from "../../FormFields";
import ApplyLoading from "../../ApplyLoading";

type Mode = "loading" | "form" | "done" | "invalid" | "conflict" | "error";
type SaveState = "idle" | "saving" | "saved" | "finishing";

export default function StudentClient({ token }: { token: string }) {
  const loadedRef = useRef(false);

  const [mode, setMode] = useState<Mode>("loading");
  const [form, setForm] = useState<FormDefinitionLike | null>(null);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  // Load the student's own saved answers and the published questions, so
  // reopening the link resumes exactly where they left off instead of blank.
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    (async () => {
      const { status, body } = await postJson("/api/public/stage2/student-draft", { token });
      if (status === 401) {
        setMode("invalid");
        return;
      }
      if (status !== 200) {
        setErrorMessage(errorCopy(status));
        setMode("error");
        return;
      }
      const published = (body.form ?? null) as FormDefinitionLike | null;
      const phase = typeof body.phase === "string" ? body.phase : "";
      const saved = (body.studentAnswers ?? {}) as Record<string, unknown>;

      setForm(published);
      setAnswers(seedAnswers(questionsOf(published, "student"), saved));
      // 2b is the only phase this section is open in. Anything later means the
      // student already sent it back and the parent has it.
      setMode(phase === "2b" ? "form" : "conflict");
    })();
  }, [token]);

  const questions = questionsOf(form, "student");
  const meta = sectionMeta(form, "student");

  function updateAnswer(key: string, value: AnswerValue) {
    setAnswers((a) => ({ ...a, [key]: value }));
    setSaveState("idle");
  }

  /** Only non-empty answers are sent; the backend merges additively. */
  function payload(): Record<string, AnswerValue> {
    const out: Record<string, AnswerValue> = {};
    for (const q of questions) {
      const v = answers[q.key];
      if (v === undefined) continue;
      if (typeof v === "string" && v.trim() === "") continue;
      if (Array.isArray(v) && v.length === 0) continue;
      out[q.key] = typeof v === "string" ? v.trim() : v;
    }
    return out;
  }

  async function post(finish: boolean) {
    setErrorMessage("");
    setSaveState(finish ? "finishing" : "saving");
    const { status } = await postJson("/api/public/stage2/student", {
      token,
      answers: payload(),
      finish,
    });
    if (status === 200) {
      if (finish) setMode("done");
      else setSaveState("saved");
      return;
    }
    setSaveState("idle");
    if (status === 401) {
      setMode("invalid");
      return;
    }
    if (status === 409) {
      setMode("conflict");
      return;
    }
    setErrorMessage(errorCopy(status));
    setMode("error");
  }

  // SAVING is not SENDING. A save keeps this section open so they can come back.
  async function handleSave() {
    setValidationError(null);
    await post(false);
  }

  async function handleFinish(e: React.FormEvent) {
    e.preventDefault();
    setValidationError(null);
    const missing = firstMissingRequired(questions, answers);
    if (missing) {
      setValidationError(
        `A few sentences is plenty — please answer "${missing.label}" before you send this to your parent.`,
      );
      return;
    }
    await post(true);
  }

  if (mode === "loading") return <ApplyLoading message="Opening your section…" />;

  if (mode === "done") {
    return (
      <Shell title="Sent!">
        <p className="text-muted">
          Your parent will review this before it goes to CurioLab. You can close this page.
        </p>
      </Shell>
    );
  }

  if (mode === "invalid") {
    return (
      <Shell title="This link isn't working">
        <p className="text-muted">
          This link isn&apos;t valid anymore &mdash; ask your parent to create a new one.
        </p>
      </Shell>
    );
  }

  if (mode === "conflict") {
    return (
      <Shell title="Not open right now">
        <p className="text-muted">
          This section isn&apos;t open right now &mdash; ask your parent to check the application.
        </p>
      </Shell>
    );
  }

  if (mode === "error") {
    return (
      <Shell title="Something went wrong">
        <p className="text-muted">{errorMessage}</p>
      </Shell>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-20">
      <p className="font-mono text-xs uppercase tracking-widest text-indigo mb-3">
        Apply &middot; Your section
      </p>
      <h1 className="text-3xl md:text-4xl font-bold mb-4">{meta?.title || "Your section"}</h1>
      <p className="text-black mb-2">
        {meta?.description ||
          "This part is yours — your own words. A few sentences for each is plenty. There are no wrong answers, and nobody is grading this."}
      </p>
      <p className="text-muted mb-10">
        You can save and come back to this any time. Your parent reads it before it is sent.
      </p>

      <form className="space-y-8" onSubmit={handleFinish}>
        <FormFields
          questions={questions}
          answers={answers}
          onChange={updateAnswer}
          disabled={saveState === "saving" || saveState === "finishing"}
        />

        {validationError && <p className="text-sm text-coral">{validationError}</p>}
        {saveState === "saved" && (
          <p className="text-sm text-sage font-medium">
            Saved. You can close this page and come back to your link later.
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saveState === "saving" || saveState === "finishing"}
            className="flex-1 border border-black/20 px-6 py-3 rounded-md font-medium hover:bg-ivory transition-colors disabled:opacity-60"
          >
            {saveState === "saving" ? "Saving…" : "Save and finish later"}
          </button>
          <button
            type="submit"
            disabled={saveState === "saving" || saveState === "finishing"}
            className="flex-1 bg-indigo text-white px-6 py-3 rounded-md font-medium hover:bg-indigo/90 transition-colors disabled:opacity-60"
          >
            {saveState === "finishing" ? "Sending…" : "I'm done — send to my parent"}
          </button>
        </div>
        <p className="text-xs text-muted">
          Saving keeps this open so you can edit it. Sending hands it to your parent to review.
        </p>
      </form>
    </div>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-20">
      <p className="font-mono text-xs uppercase tracking-widest text-indigo mb-3">
        Apply &middot; Your section
      </p>
      <h1 className="text-3xl md:text-4xl font-bold mb-4">{title}</h1>
      {children}
    </div>
  );
}
