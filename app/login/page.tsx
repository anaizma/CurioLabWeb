"use client";

import Link from "next/link";
import { useState } from "react";

interface Membership {
  role: string;
  status: string;
}
interface SessionSummary {
  memberships?: Membership[];
  guardianOf?: string[];
}

// Where a freshly authenticated account lands, based on the roles it holds.
// Only director/student/parent portals exist today; admin/staff/mentors reuse
// the director portal until their own shells ship.
function destinationFor(summary: SessionSummary): string {
  const roles = new Set((summary.memberships ?? []).map((m) => m.role));
  if (roles.has("student")) return "/portal/student";
  if (
    roles.has("chapter_director") ||
    roles.has("platform_admin") ||
    roles.has("platform_staff") ||
    roles.has("lead_instructor") ||
    roles.has("senior_instructor") ||
    roles.has("junior_mentor") ||
    roles.has("comms_associate") ||
    roles.has("safety_officer")
  ) {
    return "/portal/director";
  }
  if ((summary.guardianOf ?? []).length > 0) return "/portal/parent";
  return "/";
}

async function goToPortal() {
  try {
    const res = await fetch("/api/auth/session", { cache: "no-store" });
    const summary = (await res.json()) as SessionSummary;
    window.location.assign(destinationFor(summary));
  } catch {
    window.location.assign("/");
  }
}

export default function LoginPage() {
  // `identifier` matches POST /api/auth/login, which resolves an account by
  // email OR username — a student signs in with their username, an adult with
  // their email.
  const [form, setForm] = useState({ identifier: "", password: "" });
  const [step, setStep] = useState<"credentials" | "totp">("credentials");
  const [pendingToken, setPendingToken] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.totpRequired && data.pendingToken) {
        setPendingToken(data.pendingToken);
        setStep("totp");
      } else if (res.ok && data.accountId) {
        await goToPortal();
      } else {
        setError("Incorrect email/username or password.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleTotp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingToken, code: code.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.accountId) {
        await goToPortal();
      } else {
        setError("That code didn't work. Enter a fresh code or a backup code.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-6 py-20">
      <p className="label-blue mb-3">Welcome back</p>
      <h1 className="text-3xl md:text-4xl font-bold mb-8">Log in</h1>

      {step === "credentials" ? (
        <form className="space-y-6" onSubmit={handleCredentials}>
          <div>
            <label className="label block mb-2">Email or username</label>
            <input
              className="w-full border border-black/20 rounded-md px-4 py-3 bg-white"
              type="text"
              autoComplete="username"
              placeholder="you@example.com or your username"
              required
              value={form.identifier}
              onChange={(e) => setForm({ ...form, identifier: e.target.value })}
            />
          </div>
          <div>
            <label className="label block mb-2">Password</label>
            <input
              className="w-full border border-black/20 rounded-md px-4 py-3 bg-white"
              type="password"
              autoComplete="current-password"
              required
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors disabled:opacity-50"
          >
            {busy ? "Checking…" : "Log in"}
          </button>
        </form>
      ) : (
        <form className="space-y-6" onSubmit={handleTotp}>
          <p className="text-sm text-muted">
            Enter the 6-digit code from your authenticator app, or a backup code.
          </p>
          <div>
            <label className="label block mb-2">Authentication code</label>
            <input
              className="w-full border border-black/20 rounded-md px-4 py-3 bg-white tracking-widest"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="123456"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors disabled:opacity-50"
          >
            {busy ? "Verifying…" : "Verify"}
          </button>
        </form>
      )}

      {error && <p className="text-sm text-coral font-medium mt-4">{error}</p>}

      <p className="text-sm text-muted mt-8">
        New to CurioLab?{" "}
        <Link href="/contact" className="text-coral font-medium hover:underline">
          Contact for support or apply →
        </Link>
      </p>
    </div>
  );
}
