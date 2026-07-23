"use client";

import { useState } from "react";
import { errorCopy, postJson, STUDENT_QUESTIONS } from "../../funnel";

type Status = "idle" | "submitting" | "done" | "invalid" | "conflict" | "error";

export default function StudentClient({ token }: { token: string }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  function updateAnswer(key: string, value: string) {
    setAnswers((a) => ({ ...a, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError(null);

    const missingRequired = STUDENT_QUESTIONS.some(
      (q) => !q.optional && !(answers[q.key] ?? "").trim(),
    );
    if (missingRequired) {
      setValidationError(
        "A few sentences for each question above is plenty — please fill those in before sending this back.",
      );
      return;
    }

    const payload: Record<string, string> = {};
    for (const q of STUDENT_QUESTIONS) {
      const value = (answers[q.key] ?? "").trim();
      if (value) payload[q.key] = value;
    }

    setStatus("submitting");
    setErrorMessage("");

    const { status: httpStatus } = await postJson("/api/public/stage2/student", {
      token,
      answers: payload,
    });

    if (httpStatus === 200) {
      setStatus("done");
      return;
    }
    if (httpStatus === 401) {
      setStatus("invalid");
      return;
    }
    if (httpStatus === 409) {
      setStatus("conflict");
      return;
    }
    setErrorMessage(errorCopy(httpStatus));
    setStatus("error");
  }

  if (status === "done") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20">
        <p className="font-mono text-xs uppercase tracking-widest text-indigo mb-3">
          Apply · Your section
        </p>
        <h1 className="text-3xl md:text-4xl font-bold mb-4">Sent!</h1>
        <p className="text-muted">
          Your parent will review this before it goes to CurioLab. You can
          close this page.
        </p>
      </div>
    );
  }

  if (status === "invalid") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20">
        <p className="font-mono text-xs uppercase tracking-widest text-indigo mb-3">
          Apply · Your section
        </p>
        <h1 className="text-3xl md:text-4xl font-bold mb-4">
          This link isn&apos;t working
        </h1>
        <p className="text-muted">
          This link isn&apos;t valid anymore — ask your parent to create a
          new one.
        </p>
      </div>
    );
  }

  if (status === "conflict") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20">
        <p className="font-mono text-xs uppercase tracking-widest text-indigo mb-3">
          Apply · Your section
        </p>
        <h1 className="text-3xl md:text-4xl font-bold mb-4">
          Not open right now
        </h1>
        <p className="text-muted">
          This section isn&apos;t open right now — ask your parent to check
          the application.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-20">
      <p className="font-mono text-xs uppercase tracking-widest text-indigo mb-3">
        Apply · Your section
      </p>
      <h1 className="text-3xl md:text-4xl font-bold mb-4">Your section</h1>
      <p className="text-black mb-2">
        This part is yours — your own words. A few sentences for each is
        plenty. There are no wrong answers, and nobody is grading this.
      </p>
      <p className="text-muted mb-10">
        Your parent will read this before it is sent.
      </p>

      <form className="space-y-8" onSubmit={handleSubmit}>
        {STUDENT_QUESTIONS.map((q) => (
          <div key={q.key}>
            <label className="label block mb-2">{q.label}</label>
            <textarea
              className="w-full border border-black/20 rounded-md px-4 py-3 bg-white"
              rows={4}
              value={answers[q.key] ?? ""}
              onChange={(e) => updateAnswer(q.key, e.target.value)}
            />
            {q.optional && (
              <p className="text-xs text-muted mt-2">
                Optional — any answer is fine, including none.
              </p>
            )}
          </div>
        ))}

        {validationError && (
          <p className="text-sm text-coral">{validationError}</p>
        )}
        {status === "error" && (
          <p className="text-sm text-coral">{errorMessage}</p>
        )}

        <button
          type="submit"
          disabled={status === "submitting"}
          className="w-full bg-indigo text-white px-6 py-3 rounded-md font-medium hover:bg-indigo/90 transition-colors disabled:opacity-60"
        >
          {status === "submitting" ? "Sending…" : "Send back to my parent"}
        </button>
      </form>
    </div>
  );
}
