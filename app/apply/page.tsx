"use client";

import Link from "next/link";
import { useState } from "react";
import { errorCopy, postJson, SS_LEAD_EMAIL } from "./funnel";

type FillerRole = "parent" | "student";
type Chapter = "" | "cwru" | "another-school";
type Status = "idle" | "submitting" | "error";

interface ApplyResult {
  suppressed: boolean;
  parentToken: string | null;
  fillerRole: FillerRole;
}

export default function ApplyPage() {
  const [email, setEmail] = useState("");
  const [fillerRole, setFillerRole] = useState<FillerRole>("parent");
  const [chapter, setChapter] = useState<Chapter>("");
  const [source, setSource] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [result, setResult] = useState<ApplyResult | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    setErrorMessage("");

    const { status: resStatus, body } = await postJson("/api/apply", {
      email,
      chapter,
      source,
      fillerRole,
    });

    if (resStatus === 201) {
      try {
        sessionStorage.setItem(SS_LEAD_EMAIL, email);
      } catch {
        // best-effort only
      }
      setResult({
        suppressed: Boolean(body.suppressed),
        parentToken: typeof body.parentToken === "string" ? body.parentToken : null,
        fillerRole,
      });
      setStatus("idle");
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
        Grades 6–12. No experience required — just curiosity.
      </p>
      <p className="text-muted mb-8">
        We&apos;ll send the next step by email.
      </p>

      {result ? (
        <div className="space-y-4">
          {result.suppressed ? (
            <p className="text-black">
              We already have a recent application started for this email —
              check your inbox for the link we sent.
            </p>
          ) : result.fillerRole === "parent" && result.parentToken ? (
            <>
              <h2 className="text-2xl font-bold mb-2">Check your email</h2>
              <p className="text-black">
                We&apos;ve sent you the application link. You can also
                continue right now.
              </p>
              <Link
                href={`/apply/parent/${result.parentToken}`}
                className="inline-block bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors"
              >
                Continue to your application →
              </Link>
              <p className="text-sm text-muted">
                The emailed link works too — both go to the same
                application.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-bold mb-2">
                We&apos;ve emailed your parent
              </h2>
              <p className="text-black">
                Ask them to look for a message from CurioLab, and to check
                the spam folder.
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
            <label className="label block mb-2">
              Who is filling this out?
            </label>
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
              <option value="cwru">
                Case Western Reserve University (Cleveland, OH)
              </option>
              <option value="another-school">
                Interested in another school
              </option>
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

          {status === "error" && (
            <p className="text-sm text-coral">{errorMessage}</p>
          )}

          <button
            type="submit"
            disabled={status === "submitting"}
            className="w-full bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors disabled:opacity-60"
          >
            {status === "submitting" ? "Submitting…" : "Apply"}
          </button>
        </form>
      )}

      <p className="text-xs text-muted mt-8">
        We only ask for an email to start. We never collect anything about a
        student on this page.
      </p>
    </div>
  );
}
