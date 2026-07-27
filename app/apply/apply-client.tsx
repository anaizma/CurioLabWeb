"use client";

import Link from "next/link";
import { useState } from "react";
import { errorCopy, postJson, SS_LEAD_EMAIL } from "./funnel";
import TurnstileWidget from "@/components/TurnstileWidget";

type FillerRole = "parent" | "student";
type Chapter = "" | "cwru";
type Status = "idle" | "submitting" | "error";

interface ApplyResult {
  suppressed: boolean;
  resent: boolean;
  parentToken: string | null;
  fillerRole: FillerRole;
}

export default function ApplyClient({ siteKey }: { siteKey: string | null }) {
  const [email, setEmail] = useState("");
  const [fillerRole, setFillerRole] = useState<FillerRole>("parent");
  const [chapter, setChapter] = useState<Chapter>("");
  const [source, setSource] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [result, setResult] = useState<ApplyResult | null>(null);
  // null until the Turnstile challenge resolves. When Turnstile is not configured
  // (siteKey null) there is nothing to wait for and the server skips the check.
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  const awaitingBotCheck = siteKey !== null && turnstileToken === null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    setErrorMessage("");

    const { status: resStatus, body } = await postJson("/api/apply", {
      email,
      chapter,
      source,
      fillerRole,
      turnstileToken,
    });

    if (resStatus === 201) {
      try {
        sessionStorage.setItem(SS_LEAD_EMAIL, email);
      } catch {
        // best-effort only
      }
      setResult({
        suppressed: Boolean(body.suppressed),
        resent: Boolean(body.resent),
        parentToken: typeof body.parentToken === "string" ? body.parentToken : null,
        fillerRole,
      });
      setStatus("idle");
      return;
    }

    // A consumed Turnstile token cannot be reused, so clear it and let the widget
    // issue a fresh one before the parent tries again.
    setTurnstileToken(null);
    if (resStatus === 403) {
      setErrorMessage(
        "We couldn't complete the security check. Please wait a moment for it to finish, then try again.",
      );
      setStatus("error");
      return;
    }
    if (resStatus === 429) {
      setErrorMessage(
        "You've tried this a few times in a row. Please wait a little while and try again, or email us at hello@acuriolab.org.",
      );
      setStatus("error");
      return;
    }
    setErrorMessage(errorCopy(resStatus));
    setStatus("error");
  }

  return (
    <div className="mx-auto max-w-md px-6 py-20">
      <p className="label-blue mb-3">Apply</p>
      <h1 className="text-3xl md:text-4xl font-bold mb-4">Apply to CurioLab</h1>
      <p className="text-muted mb-2">
        Grades 6&ndash;12. No experience required. From curiosity to creation.
      </p>
      <p className="text-muted mb-8">We&apos;ll send the next step by email.</p>

      {result ? (
        <div className="space-y-4">
          {result.fillerRole === "parent" && result.parentToken ? (
            <>
              <h2 className="text-2xl font-bold mb-2">
                {result.resent ? "We re-sent your link" : "Check your email"}
              </h2>
              <p className="text-black">
                {result.resent
                  ? "We've emailed you a fresh application link. Any earlier link is now inactive. You can also continue right now."
                  : "We've sent you the application link. You can also continue right now."}
              </p>
              <Link
                href={`/apply/parent/${result.parentToken}`}
                className="inline-block bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors"
              >
                Continue to your application &rarr;
              </Link>
              <p className="text-sm text-muted">
                The emailed link works too - both go to the same application.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-bold mb-2">
                {result.resent ? "We re-sent the link to your parent" : "We've emailed your parent"}
              </h2>
              <p className="text-black">
                Ask them to look for a message from CurioLab, and to check the spam folder.
              </p>
            </>
          )}
        </div>
      ) : (
        <form className="space-y-6" onSubmit={handleSubmit}>
          <div>
            <label className="label block mb-2">Parent/guardian email</label>
            <input
              className="w-full border border-black/20 rounded-md px-4 py-3 bg-white"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div>
            <label className="label block mb-2">Who is filling this out?</label>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-black">
                <input
                  type="radio"
                  name="fillerRole"
                  value="parent"
                  checked={fillerRole === "parent"}
                  onChange={() => setFillerRole("parent")}
                />
                Parent/guardian
              </label>
              <label className="flex items-center gap-2 text-black">
                <input
                  type="radio"
                  name="fillerRole"
                  value="student"
                  checked={fillerRole === "student"}
                  onChange={() => setFillerRole("student")}
                />
                Student
              </label>
            </div>
          </div>

          <div>
            <label className="label block mb-2">Chapter</label>
            <select
              className="w-full border border-black/20 rounded-md px-4 py-3 bg-white"
              required
              value={chapter}
              onChange={(e) => setChapter(e.target.value as Chapter)}
            >
              <option value="" disabled>
                Select a chapter
              </option>
              <option value="cwru">Case Western Reserve University (Cleveland, OH)</option>
            </select>
          </div>

          <div>
            <label className="label block mb-2">
              How did you hear about CurioLab? (optional)
            </label>
            <input
              className="w-full border border-black/20 rounded-md px-4 py-3 bg-white"
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </div>

          <TurnstileWidget siteKey={siteKey} onToken={setTurnstileToken} />

          {status === "error" && <p className="text-sm text-coral">{errorMessage}</p>}

          <button
            type="submit"
            disabled={status === "submitting" || awaitingBotCheck}
            className="w-full bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors disabled:opacity-60"
          >
            {status === "submitting"
              ? "Submitting…"
              : awaitingBotCheck
                ? "Just a moment…"
                : "Apply"}
          </button>
        </form>
      )}
    </div>
  );
}
