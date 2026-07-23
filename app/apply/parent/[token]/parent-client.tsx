"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { errorCopy, postJson, SS_LEAD_EMAIL, studentLinkUrl } from "../../funnel";

type Mode = "loading" | "form" | "invalid" | "error";
type SaveStatus = "idle" | "submitting" | "saved" | "conflict" | "error";
type LinkStatus = "idle" | "creating" | "error";

interface ParentForm {
  childFirstName: string;
  childLastName: string;
  childDob: string;
  gradeEntering: string;
  schoolName: string;
  guardianFirstName: string;
  guardianLastName: string;
  guardianEmail: string;
  guardianPhone: string;
  relationship: string;
  secondGuardianName: string;
  secondGuardianEmail: string;
  saturdayAvailability: boolean;
  commitmentAcknowledged: boolean;
  scholarshipInterest: boolean;
  attestedGuardian: boolean;
  contactConsent: boolean;
}

const EMPTY_FORM: ParentForm = {
  childFirstName: "",
  childLastName: "",
  childDob: "",
  gradeEntering: "",
  schoolName: "",
  guardianFirstName: "",
  guardianLastName: "",
  guardianEmail: "",
  guardianPhone: "",
  relationship: "",
  secondGuardianName: "",
  secondGuardianEmail: "",
  saturdayAvailability: false,
  commitmentAcknowledged: false,
  scholarshipInterest: false,
  attestedGuardian: false,
  contactConsent: false,
};

export default function ParentClient({ token }: { token: string }) {
  const router = useRouter();
  const startedRef = useRef(false);

  const [mode, setMode] = useState<Mode>("loading");
  const [modeErrorMessage, setModeErrorMessage] = useState("");
  const [alreadyStarted, setAlreadyStarted] = useState(false);

  const [form, setForm] = useState<ParentForm>(() => {
    if (typeof window === "undefined") return EMPTY_FORM;
    try {
      const savedEmail = sessionStorage.getItem(SS_LEAD_EMAIL);
      return savedEmail ? { ...EMPTY_FORM, guardianEmail: savedEmail } : EMPTY_FORM;
    } catch {
      return EMPTY_FORM;
    }
  });
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveErrorMessage, setSaveErrorMessage] = useState("");
  const [showStudentLink, setShowStudentLink] = useState(false);

  const [linkStatus, setLinkStatus] = useState<LinkStatus>("idle");
  const [linkErrorMessage, setLinkErrorMessage] = useState("");
  const [studentLink, setStudentLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Phase-router: figure out where this parent token currently sits, since
  // there is no direct phase-read endpoint — try-and-branch off start/review.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    async function run() {
      const start = await postJson("/api/public/stage2/start", { token });

      if (start.status === 201) {
        setMode("form");
        return;
      }

      if (start.status === 401) {
        setMode("invalid");
        return;
      }

      if (start.status === 409) {
        const review = await postJson("/api/public/stage2/review", { token });

        if (review.status === 200) {
          router.replace(`/apply/review/${token}`);
          return;
        }
        if (review.status === 409) {
          setAlreadyStarted(true);
          setShowStudentLink(true);
          setMode("form");
          return;
        }
        if (review.status === 401) {
          setMode("invalid");
          return;
        }
        setModeErrorMessage(errorCopy(review.status));
        setMode("error");
        return;
      }

      setModeErrorMessage(errorCopy(start.status));
      setMode("error");
    }

    run();
  }, [token, router]);

  function updateField<K extends keyof ParentForm>(key: K, value: ParentForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveStatus("submitting");
    setSaveErrorMessage("");

    const childName = `${form.childFirstName.trim()} ${form.childLastName.trim()}`.trim();
    const guardianName = `${form.guardianFirstName.trim()} ${form.guardianLastName.trim()}`.trim();

    const answers: Record<string, unknown> = {
      childFirstName: form.childFirstName.trim(),
      childLastName: form.childLastName.trim(),
      childName,
      childDob: form.childDob,
      gradeEntering: form.gradeEntering,
      schoolName: form.schoolName.trim(),
      guardianFirstName: form.guardianFirstName.trim(),
      guardianLastName: form.guardianLastName.trim(),
      guardianName,
      guardianEmail: form.guardianEmail.trim(),
      guardianPhone: form.guardianPhone.trim(),
      relationship: form.relationship,
      saturdayAvailability: form.saturdayAvailability,
      commitmentAcknowledged: form.commitmentAcknowledged,
      attestedGuardian: form.attestedGuardian,
      contactConsent: form.contactConsent,
    };
    if (form.secondGuardianName.trim()) {
      answers.secondGuardianName = form.secondGuardianName.trim();
    }
    if (form.secondGuardianEmail.trim()) {
      answers.secondGuardianEmail = form.secondGuardianEmail.trim();
    }
    if (form.scholarshipInterest) {
      answers.scholarshipInterest = true;
    }

    const { status } = await postJson("/api/public/stage2/parent", { token, answers });

    if (status === 200) {
      setSaveStatus("saved");
      setShowStudentLink(true);
      return;
    }
    if (status === 409) {
      setSaveStatus("conflict");
      setShowStudentLink(true);
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
    return (
      <div className="mx-auto max-w-2xl px-6 py-20">
        <p className="text-muted">Checking your application link…</p>
      </div>
    );
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

  return (
    <div className="mx-auto max-w-2xl px-6 py-20">
      <p className="label-blue mb-3">Apply · Parent/guardian section</p>
      <h1 className="text-3xl md:text-4xl font-bold mb-8">
        Tell us about your student
      </h1>

      {alreadyStarted && (
        <div className="border border-sage rounded-md bg-sage/10 px-4 py-3 mb-8 text-sm text-ink">
          Welcome back. If you&apos;ve already saved this section, re-saving
          may not be available — your student link tool is below.
        </div>
      )}

      <form className="space-y-8" onSubmit={handleSave}>
        <div className="space-y-6">
          <h2 className="text-xl font-bold">Student</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label block mb-2">Student first name</label>
              <input
                className="w-full border border-black/20 rounded-md px-4 py-3 bg-white"
                type="text"
                required
                value={form.childFirstName}
                onChange={(e) => updateField("childFirstName", e.target.value)}
              />
            </div>
            <div>
              <label className="label block mb-2">Student last name</label>
              <input
                className="w-full border border-black/20 rounded-md px-4 py-3 bg-white"
                type="text"
                required
                value={form.childLastName}
                onChange={(e) => updateField("childLastName", e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="label block mb-2">Date of birth</label>
            <input
              className="w-full border border-black/20 rounded-md px-4 py-3 bg-white"
              type="date"
              required
              value={form.childDob}
              onChange={(e) => updateField("childDob", e.target.value)}
            />
          </div>

          <div>
            <label className="label block mb-2">Grade entering in the fall</label>
            <select
              className="w-full border border-black/20 rounded-md px-4 py-3 bg-white"
              required
              value={form.gradeEntering}
              onChange={(e) => updateField("gradeEntering", e.target.value)}
            >
              <option value="" disabled>
                Select a grade
              </option>
              {["6", "7", "8", "9", "10", "11", "12"].map((grade) => (
                <option key={grade} value={grade}>
                  Grade {grade}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label block mb-2">School</label>
            <input
              className="w-full border border-black/20 rounded-md px-4 py-3 bg-white"
              type="text"
              required
              value={form.schoolName}
              onChange={(e) => updateField("schoolName", e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-6">
          <h2 className="text-xl font-bold">Parent / guardian</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label block mb-2">Your first name</label>
              <input
                className="w-full border border-black/20 rounded-md px-4 py-3 bg-white"
                type="text"
                required
                value={form.guardianFirstName}
                onChange={(e) => updateField("guardianFirstName", e.target.value)}
              />
            </div>
            <div>
              <label className="label block mb-2">Your last name</label>
              <input
                className="w-full border border-black/20 rounded-md px-4 py-3 bg-white"
                type="text"
                required
                value={form.guardianLastName}
                onChange={(e) => updateField("guardianLastName", e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="label block mb-2">Your email</label>
            <input
              className="w-full border border-black/20 rounded-md px-4 py-3 bg-white"
              type="email"
              required
              value={form.guardianEmail}
              onChange={(e) => updateField("guardianEmail", e.target.value)}
            />
          </div>

          <div>
            <label className="label block mb-2">Your phone</label>
            <input
              className="w-full border border-black/20 rounded-md px-4 py-3 bg-white"
              type="tel"
              required
              value={form.guardianPhone}
              onChange={(e) => updateField("guardianPhone", e.target.value)}
            />
          </div>

          <div>
            <label className="label block mb-2">Relationship to student</label>
            <select
              className="w-full border border-black/20 rounded-md px-4 py-3 bg-white"
              required
              value={form.relationship}
              onChange={(e) => updateField("relationship", e.target.value)}
            >
              <option value="" disabled>
                Select one
              </option>
              <option value="Parent">Parent</option>
              <option value="Legal guardian">Legal guardian</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label block mb-2">
                Second guardian name (optional)
              </label>
              <input
                className="w-full border border-black/20 rounded-md px-4 py-3 bg-white"
                type="text"
                value={form.secondGuardianName}
                onChange={(e) => updateField("secondGuardianName", e.target.value)}
              />
            </div>
            <div>
              <label className="label block mb-2">
                Second guardian email (optional)
              </label>
              <input
                className="w-full border border-black/20 rounded-md px-4 py-3 bg-white"
                type="email"
                value={form.secondGuardianEmail}
                onChange={(e) => updateField("secondGuardianEmail", e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted -mt-4">
            Password resets for a minor route to all verified guardians — a
            second contact avoids a stall.
          </p>
        </div>

        <div className="space-y-4">
          <h2 className="text-xl font-bold">A few confirmations</h2>

          <label className="flex items-start gap-3 text-black">
            <input
              type="checkbox"
              className="mt-1"
              required
              checked={form.saturdayAvailability}
              onChange={(e) => updateField("saturdayAvailability", e.target.checked)}
            />
            <span>
              My family can commit to Saturday sessions this semester.
            </span>
          </label>

          <label className="flex items-start gap-3 text-black">
            <input
              type="checkbox"
              className="mt-1"
              required
              checked={form.commitmentAcknowledged}
              onChange={(e) => updateField("commitmentAcknowledged", e.target.checked)}
            />
            <span>
              I understand CurioLab meets on Saturdays, includes a semester
              fee, and requires an interview as part of the application
              process.
            </span>
          </label>

          <label className="flex items-start gap-3 text-black">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.scholarshipInterest}
              onChange={(e) => updateField("scholarshipInterest", e.target.checked)}
            />
            <span>
              Would you like information about need-based scholarships?
            </span>
          </label>

          <label className="flex items-start gap-3 text-black">
            <input
              type="checkbox"
              className="mt-1"
              required
              checked={form.attestedGuardian}
              onChange={(e) => updateField("attestedGuardian", e.target.checked)}
            />
            <span>I am the parent or legal guardian of this student.</span>
          </label>

          <label className="flex items-start gap-3 text-black">
            <input
              type="checkbox"
              className="mt-1"
              required
              checked={form.contactConsent}
              onChange={(e) => updateField("contactConsent", e.target.checked)}
            />
            <span>I consent to be contacted about this application.</span>
          </label>

          <p className="text-xs text-muted">See our privacy notice.</p>
        </div>

        {saveStatus === "error" && (
          <p className="text-sm text-coral">{saveErrorMessage}</p>
        )}
        {saveStatus === "saved" && (
          <p className="text-sm text-sage font-medium">
            Saved. Your student link tool is below.
          </p>
        )}
        {saveStatus === "conflict" && (
          <p className="text-sm text-black">
            This section is already locked in — your application has moved
            to the next step. Your student link tool is below.
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
            Your student fills in their own section, in their own words.
            Create a link and pass it to them however you like — we never
            ask for a student email.
          </p>

          <button
            type="button"
            onClick={handleCreateLink}
            disabled={linkStatus === "creating"}
            className="bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors disabled:opacity-60"
          >
            {linkStatus === "creating"
              ? "Creating…"
              : "Create a link to send to my student"}
          </button>

          {linkStatus === "error" && (
            <p className="text-sm text-coral mt-3">{linkErrorMessage}</p>
          )}

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
              <p className="text-xs text-muted">
                Creating a new link replaces the old one.
              </p>
              <p className="text-sm text-black">
                When they&apos;re done, come back here to review and submit —
                or head there now:{" "}
                <Link
                  href={`/apply/review/${token}`}
                  className="text-coral font-medium hover:underline"
                >
                  Review and submit →
                </Link>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
