"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  errorCopy,
  postJson,
  PARENT_FIELD_LABELS,
  type FormDefinitionLike,
} from "../../funnel";
import { questionsOf } from "../../FormFields";
import ApplyLoading from "../../ApplyLoading";

type Mode =
  | "loading"
  | "review"
  | "notReady"
  | "invalid"
  | "error"
  | "submitted"
  | "sentBack";
type ActionStatus = "idle" | "submitting" | "sendingBack";

interface ReviewData {
  parentAnswers: Record<string, unknown>;
  studentAnswers: Record<string, unknown>;
  form: FormDefinitionLike | null;
}

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function displayValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
  return String(value);
}

/** Turn a bare answer key into something readable, for an answer whose question
 *  is no longer on the form (the director removed it after it was answered). */
function humanizeKey(k: string): string {
  return k
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * Every answer the applicant actually gave, labelled by the stamped form. Answers
 * are driven by the ANSWER blob, not the question list, so an answer whose
 * question was since removed is still shown rather than silently disappearing
 * from the parent's last look before they submit.
 */
function labelledAnswers(
  form: FormDefinitionLike | null,
  section: "parent" | "student",
  blob: Record<string, unknown>,
  fallbackLabels: Readonly<Record<string, string>> = {},
): { key: string; label: string; value: string }[] {
  const questions = questionsOf(form, section);
  const order = new Map(questions.map((q, i) => [q.key, i]));
  const labelOf = new Map(questions.map((q) => [q.key, q.label]));

  return Object.keys(blob)
    .filter((k) => hasValue(blob[k]))
    // The combined convenience keys duplicate the split first/last name fields.
    .filter((k) => order.has(k) || fallbackLabels[k] !== undefined)
    .sort((a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER))
    .map((k) => ({
      key: k,
      label: labelOf.get(k) ?? fallbackLabels[k] ?? humanizeKey(k),
      value: displayValue(blob[k]),
    }));
}

export default function ReviewClient({ token }: { token: string }) {
  const startedRef = useRef(false);

  const [mode, setMode] = useState<Mode>("loading");
  const [modeErrorMessage, setModeErrorMessage] = useState("");
  const [data, setData] = useState<ReviewData | null>(null);

  const [actionStatus, setActionStatus] = useState<ActionStatus>("idle");
  const [submitError, setSubmitError] = useState<{
    missingDetails: boolean;
    message: string;
  } | null>(null);
  const [sendBackError, setSendBackError] = useState("");

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    async function run() {
      const { status, body } = await postJson("/api/public/stage2/review", {
        token,
      });

      if (status === 200) {
        setData({
          form: (body.form as FormDefinitionLike | null) ?? null,
          parentAnswers:
            (body.parentAnswers as Record<string, unknown>) ?? {},
          studentAnswers:
            (body.studentAnswers as Record<string, unknown>) ?? {},
        });
        setMode("review");
        return;
      }
      if (status === 409) {
        setMode("notReady");
        return;
      }
      if (status === 401) {
        setMode("invalid");
        return;
      }
      setModeErrorMessage(errorCopy(status));
      setMode("error");
    }

    run();
  }, [token]);

  async function handleSubmit() {
    setActionStatus("submitting");
    setSubmitError(null);

    const { status } = await postJson("/api/public/stage2/submit", { token });

    if (status === 201) {
      setActionStatus("idle");
      setMode("submitted");
      return;
    }
    if (status === 400) {
      setSubmitError({
        missingDetails: true,
        message:
          "The parent section is missing required details (student name, guardian name, guardian email).",
      });
      setActionStatus("idle");
      return;
    }
    setSubmitError({ missingDetails: false, message: errorCopy(status) });
    setActionStatus("idle");
  }

  async function handleSendBack() {
    setActionStatus("sendingBack");
    setSendBackError("");

    const { status } = await postJson("/api/public/stage2/send-back", {
      token,
    });

    if (status === 200) {
      setActionStatus("idle");
      setMode("sentBack");
      return;
    }
    setSendBackError(errorCopy(status));
    setActionStatus("idle");
  }

  if (mode === "loading") {
    return <ApplyLoading message="Checking your application…" />;
  }

  if (mode === "invalid") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20">
        <p className="label-blue mb-3">Apply</p>
        <h1 className="text-3xl md:text-4xl font-bold mb-4">
          This link isn&apos;t working
        </h1>
        <p className="text-muted">{errorCopy(401)}</p>
      </div>
    );
  }

  if (mode === "notReady") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20">
        <p className="label-blue mb-3">Apply</p>
        <h1 className="text-3xl md:text-4xl font-bold mb-4">Not ready yet</h1>
        <p className="text-muted mb-6">
          Your application isn&apos;t at the review step right now. If your
          student is still writing their section, check back after they
          finish. If you&apos;ve already submitted, you&apos;re all set —
          nothing more to do.
        </p>
        <Link
          href={`/apply/parent/${token}`}
          className="text-coral font-medium hover:underline"
        >
          Back to your section →
        </Link>
      </div>
    );
  }

  if (mode === "error") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20">
        <p className="label-blue mb-3">Apply</p>
        <h1 className="text-3xl md:text-4xl font-bold mb-4">
          Something went wrong
        </h1>
        <p className="text-muted">{modeErrorMessage}</p>
      </div>
    );
  }

  if (mode === "submitted") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20">
        <p className="label-blue mb-3">Apply</p>
        <h1 className="text-3xl md:text-4xl font-bold mb-4">
          Application submitted
        </h1>
        <p className="text-muted">
          A Chapter Director will be in touch about the interview. We&apos;ve
          got it from here.
        </p>
      </div>
    );
  }

  if (mode === "sentBack") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20">
        <p className="label-blue mb-3">Apply</p>
        <h1 className="text-3xl md:text-4xl font-bold mb-4">Sent back.</h1>
        <p className="text-muted mb-6">
          Create a fresh student link if they need one.
        </p>
        <Link
          href={`/apply/parent/${token}`}
          className="text-coral font-medium hover:underline"
        >
          Back to your section →
        </Link>
      </div>
    );
  }

  if (mode === "review" && data) {
    const parentEntries = labelledAnswers(
      data.form,
      "parent",
      data.parentAnswers,
      PARENT_FIELD_LABELS,
    );
    const studentEntries = labelledAnswers(data.form, "student", data.studentAnswers);

    return (
      <div className="mx-auto max-w-2xl px-6 py-20">
        <p className="label-blue mb-3">Apply · Review and submit</p>
        <h1 className="text-3xl md:text-4xl font-bold mb-8">
          Review before you submit
        </h1>

        <div className="space-y-4 mb-12">
          <h2 className="text-xl font-bold">About your student</h2>
          <dl className="space-y-4">
            {parentEntries.map((entry) => (
              <div key={entry.key}>
                <dt className="label mb-1">{entry.label}</dt>
                <dd className="text-black">{entry.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="space-y-6 mb-12">
          <h2 className="text-xl font-bold">Your student&apos;s own words</h2>
          {studentEntries.map((entry) => (
            <div key={entry.key}>
              <p className="label mb-1">{entry.label}</p>
              <p className="text-black whitespace-pre-wrap">{entry.value}</p>
            </div>
          ))}
        </div>

        {submitError && (
          <div className="mb-6 text-sm text-coral">
            <p>{submitError.message}</p>
            {submitError.missingDetails && (
              <Link
                href={`/apply/parent/${token}`}
                className="font-medium hover:underline"
              >
                Back to the parent section →
              </Link>
            )}
          </div>
        )}

        {sendBackError && (
          <p className="mb-6 text-sm text-coral">{sendBackError}</p>
        )}

        <div className="space-y-4">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={actionStatus !== "idle"}
            className="w-full bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors disabled:opacity-60"
          >
            {actionStatus === "submitting" ? "Submitting…" : "Submit application"}
          </button>

          <div>
            <button
              type="button"
              onClick={handleSendBack}
              disabled={actionStatus !== "idle"}
              className="w-full border border-black/20 rounded-md px-6 py-3 font-medium hover:bg-ivory transition-colors disabled:opacity-60"
            >
              {actionStatus === "sendingBack"
                ? "Sending back…"
                : "Send back to my student"}
            </button>
            <p className="text-xs text-muted mt-2">
              They&apos;ll be able to edit their section again; you&apos;ll
              review the new version before anything is sent.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
