"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { errorCopy, postJson, SS_LEAD_EMAIL, studentLinkUrl, type FormDefinitionLike } from "../../funnel";
import FormFields, {
  firstMissingRequired,
  questionsOf,
  seedAnswers,
  sectionMeta,
  type AnswerMap,
  type AnswerValue,
} from "../../FormFields";
import ApplyLoading from "../../ApplyLoading";

type Mode = "loading" | "form" | "invalid" | "error";
type SaveStatus = "idle" | "submitting" | "saved" | "error";
type LinkStatus = "idle" | "creating" | "error";

export default function ParentClient({ token }: { token: string }) {
  const router = useRouter();
  const startedRef = useRef(false);

  const [mode, setMode] = useState<Mode>("loading");
  const [modeErrorMessage, setModeErrorMessage] = useState("");
  const [form, setForm] = useState<FormDefinitionLike | null>(null);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [resumed, setResumed] = useState(false);

  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveErrorMessage, setSaveErrorMessage] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showStudentLink, setShowStudentLink] = useState(false);

  const [linkStatus, setLinkStatus] = useState<LinkStatus>("idle");
  const [linkErrorMessage, setLinkErrorMessage] = useState("");
  const [studentLink, setStudentLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Start the draft if this is the first visit, then load whatever is saved so a
  // returning parent sees their own answers filled in. The old flow could not
  // read the draft, so it hid the form behind a "re-entering replaces everything"
  // warning; the draft-read endpoint removes that whole problem.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      const start = await postJson("/api/public/stage2/start", { token });
      if (start.status === 401) {
        setMode("invalid");
        return;
      }
      if (start.status !== 201 && start.status !== 409) {
        setModeErrorMessage(errorCopy(start.status));
        setMode("error");
        return;
      }

      const draft = await postJson("/api/public/stage2/draft", { token });
      if (draft.status === 401) {
        setMode("invalid");
        return;
      }
      if (draft.status !== 200) {
        setModeErrorMessage(errorCopy(draft.status));
        setMode("error");
        return;
      }

      const published = (draft.body.form ?? null) as FormDefinitionLike | null;
      const saved = (draft.body.parentAnswers ?? {}) as Record<string, unknown>;
      const phase = typeof draft.body.phase === "string" ? draft.body.phase : "2a";

      // A finished student section means the application is waiting at review.
      if (phase === "2c") {
        router.replace(`/apply/review/${token}`);
        return;
      }
      if (phase === "submitted") {
        setModeErrorMessage(
          "This application has already been submitted. We'll be in touch by email.",
        );
        setMode("error");
        return;
      }

      const seeded = seedAnswers(questionsOf(published, "parent"), saved);
      // Same-device convenience: prefill the guardian email captured at Stage 1
      // when the draft has nothing saved for it yet.
      if (typeof window !== "undefined") {
        try {
          const leadEmail = sessionStorage.getItem(SS_LEAD_EMAIL);
          if (leadEmail && seeded.guardianEmail === "") seeded.guardianEmail = leadEmail;
        } catch {
          // best-effort only
        }
      }

      setForm(published);
      setAnswers(seeded);
      setResumed(Object.keys(saved).length > 0);
      setShowStudentLink(phase === "2b");
      setMode("form");
    })();
  }, [token, router]);

  const questions = questionsOf(form, "parent");
  const meta = sectionMeta(form, "parent");

  function updateAnswer(key: string, value: AnswerValue) {
    setAnswers((a) => ({ ...a, [key]: value }));
    setSaveStatus("idle");
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setValidationError(null);

    const missing = firstMissingRequired(questions, answers);
    if (missing) {
      setValidationError(`Please complete "${missing.label}" before saving.`);
      return;
    }

    setSaveStatus("submitting");
    setSaveErrorMessage("");

    // Every question is sent on every save, including blanks, because the backend
    // merges additively: a key omitted here would keep its previous server value,
    // so an answer the parent just cleared could never actually be cleared.
    const payload: Record<string, AnswerValue> = {};
    for (const q of questions) {
      const v = answers[q.key];
      payload[q.key] = typeof v === "string" ? v.trim() : (v ?? "");
    }

    const { status } = await postJson("/api/public/stage2/parent", { token, answers: payload });

    if (status === 200) {
      setSaveStatus("saved");
      setShowStudentLink(true);
      return;
    }
    if (status === 401) {
      setMode("invalid");
      return;
    }
    setSaveErrorMessage(errorCopy(status));
    setSaveStatus("error");
  }

  async function handleCreateLink() {
    setLinkStatus("creating");
    setLinkErrorMessage("");
    setCopied(false);

    const { status, body } = await postJson("/api/public/stage2/student-link", { token });

    if (status === 200 && typeof body.studentToken === "string") {
      setStudentLink(studentLinkUrl(body.studentToken));
      setLinkStatus("idle");
      return;
    }
    if (status === 409) {
      setLinkErrorMessage(
        "Save your section first — the link becomes available once it's saved. (If you've already reached the review step, the link isn't needed anymore.)",
      );
      setLinkStatus("error");
      return;
    }
    setLinkErrorMessage(errorCopy(status));
    setLinkStatus("error");
  }

  async function handleCopy() {
    if (!studentLink) return;
    try {
      await navigator.clipboard.writeText(studentLink);
      setCopied(true);
    } catch {
      // Fallback below (select-on-focus input) covers browsers/permissions
      // that block programmatic clipboard writes.
    }
  }

  if (mode === "loading") {
    return <ApplyLoading message="Checking your application link…" />;
  }

  if (mode === "invalid") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20">
        <p className="label-blue mb-3">Apply</p>
        <h1 className="text-3xl md:text-4xl font-bold mb-4">This link isn&apos;t working</h1>
        <p className="text-muted">{errorCopy(401)}</p>
      </div>
    );
  }

  if (mode === "error") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20">
        <p className="label-blue mb-3">Apply</p>
        <h1 className="text-3xl md:text-4xl font-bold mb-4">Something went wrong</h1>
        <p className="text-muted">{modeErrorMessage}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-20">
      <p className="label-blue mb-3">Apply &middot; Parent/guardian section</p>
      <h1 className="text-3xl md:text-4xl font-bold mb-4">
        {meta?.title || "Tell us about your student"}
      </h1>
      {meta?.description && <p className="text-muted mb-4">{meta.description}</p>}
      <p className="text-muted mb-8">
        {resumed
          ? "We've filled in what you saved before. Change anything you need to and save again."
          : "You can save this and come back to it later — saving isn't submitting."}
      </p>

      <form className="space-y-8" onSubmit={handleSave}>
        <div className="space-y-6">
          <FormFields
            questions={questions}
            answers={answers}
            onChange={updateAnswer}
            disabled={saveStatus === "submitting"}
          />
        </div>

        {validationError && <p className="text-sm text-coral">{validationError}</p>}
        {saveStatus === "error" && <p className="text-sm text-coral">{saveErrorMessage}</p>}
        {saveStatus === "saved" && (
          <p className="text-sm text-sage font-medium">
            Saved. You can reopen this link any time to change it, right up until you submit.
          </p>
        )}

        <button
          type="submit"
          disabled={saveStatus === "submitting"}
          className="w-full bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors disabled:opacity-60"
        >
          {saveStatus === "submitting" ? "Saving…" : "Save"}
        </button>
      </form>

      {showStudentLink && (
        <div className="mt-12 border-t border-black/10 pt-8">
          <h2 className="text-xl font-bold mb-2">Your student&apos;s section</h2>
          <p className="text-muted mb-4">
            Your student fills in their own section, in their own words. Create a link and pass it
            to them however you like &mdash; we never ask for a student email.
          </p>

          <button
            type="button"
            onClick={handleCreateLink}
            disabled={linkStatus === "creating"}
            className="bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors disabled:opacity-60"
          >
            {linkStatus === "creating" ? "Creating…" : "Create a link to send to my student"}
          </button>

          {linkStatus === "error" && <p className="text-sm text-coral mt-3">{linkErrorMessage}</p>}

          {studentLink && (
            <div className="mt-6 space-y-3">
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  className="w-full border border-black/20 rounded-md px-4 py-3 bg-white text-sm"
                  type="text"
                  readOnly
                  value={studentLink}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  className="shrink-0 border border-black/20 rounded-md px-6 py-3 font-medium hover:bg-ivory transition-colors"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <p className="text-xs text-muted">Creating a new link replaces the old one.</p>
              <p className="text-sm text-black">
                When they&apos;re done, come back here to review and submit &mdash; or head there
                now:{" "}
                <Link
                  href={`/apply/review/${token}`}
                  className="text-coral font-medium hover:underline"
                >
                  Review and submit &rarr;
                </Link>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
