"use client";

import Link from "next/link";
import { useState } from "react";
import BackupCodes from "@/components/auth/BackupCodes";
import NewPasswordFields, { newPasswordReady, type NewPasswordState } from "@/components/auth/NewPasswordFields";
import TotpEnrollment from "@/components/auth/TotpEnrollment";
import { safeNextPath } from "@/lib/portal/director/gate";

interface Membership {
  role: string;
  status: string;
}
interface SessionSummary {
  memberships?: Membership[];
  guardianOf?: string[];
}

// Where a freshly authenticated account lands, based on the roles it holds.
//
// Only the director/student/parent portals exist. The director portal is now
// gated to ACTIVE chapter_director / platform_admin (lib/portal/director/gate.ts),
// so the other privileged roles are deliberately NOT sent there any more: doing
// so would bounce a mentor straight back to /login in a loop. They land on the
// public site until their own portal ships.
function destinationFor(summary: SessionSummary): string {
  const active = (summary.memberships ?? []).filter((m) => m.status === "active");
  const roles = new Set(active.map((m) => m.role));
  if (roles.has("student")) return "/portal/student";
  if (roles.has("chapter_director") || roles.has("platform_admin")) return "/portal/director";
  if ((summary.guardianOf ?? []).length > 0) return "/portal/parent";
  return "/";
}

async function goToPortal(next: string | null) {
  try {
    const res = await fetch("/api/auth/session", { cache: "no-store" });
    const summary = (await res.json()) as SessionSummary;
    const home = destinationFor(summary);
    // Honour ?next= only when it is a real in-app path (safeNextPath refuses an
    // absolute or protocol-relative URL, so login cannot be an open redirect) and
    // only when the account can actually reach it.
    const target = next !== null && safeNextPath(next).startsWith(home) ? safeNextPath(next) : home;
    window.location.assign(target);
  } catch {
    window.location.assign("/");
  }
}

type Step = "credentials" | "totp" | "enroll" | "backup" | "changePassword";

interface EnrollmentState {
  secret: string;
  otpauthUri: string;
}

export default function LoginClient({ next = null, reset = false }: { next?: string | null; reset?: boolean }) {
  // `identifier` matches POST /api/auth/login, which resolves an account by
  // email OR username — a student signs in with their username, an adult with
  // their email.
  const [form, setForm] = useState({ identifier: "", password: "" });
  const [step, setStep] = useState<Step>("credentials");
  const [pendingToken, setPendingToken] = useState("");
  const [code, setCode] = useState("");
  const [enrollment, setEnrollment] = useState<EnrollmentState | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [newPassword, setNewPassword] = useState<NewPasswordState>({ password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(
    reset ? "Your password has been changed. Sign in with your new password." : "",
  );

  /**
   * Begin forced enrollment: exchange the pending token for the secret + otpauth
   * URI. A privileged account with no second factor lands here, which used to be
   * a dead end reported as a wrong password.
   */
  async function beginEnrollment(token: string) {
    const res = await fetch("/api/auth/totp/enroll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pendingToken: token }),
    });
    const data = await res.json();
    if (!res.ok || typeof data.secret !== "string" || typeof data.otpauthUri !== "string") {
      setError("We couldn't start two-step setup. Please try signing in again.");
      return;
    }
    setEnrollment({ secret: data.secret, otpauthUri: data.otpauthUri });
    setStep("enroll");
  }

  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
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
      } else if (data.totpEnrollmentRequired && data.pendingToken) {
        setPendingToken(data.pendingToken);
        await beginEnrollment(data.pendingToken);
      } else if (data.passwordChangeRequired && data.pendingToken) {
        // A temporary or operator-set credential. The password was correct, but
        // no session exists until it is replaced. Reported as a wrong password
        // before this branch existed, which locked the account out for good.
        setPendingToken(data.pendingToken);
        setStep("changePassword");
      } else if (res.ok && data.accountId) {
        await goToPortal(next);
      } else if (res.status === 429) {
        setError("Too many attempts. Please wait a few minutes and try again.");
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
        await goToPortal(next);
      } else if (res.status === 429) {
        setError("Too many codes tried. Please wait a few minutes and try again.");
      } else {
        setError("That code didn't work. Enter a fresh code or a backup code.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  /** Confirm enrollment: activates TOTP, mints the session, returns the codes ONCE. */
  async function handleConfirmEnrollment(enteredCode: string) {
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/totp/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingToken, code: enteredCode }),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.backupCodes)) {
        setBackupCodes(data.backupCodes as string[]);
        // Straight to the codes: they are shown once and are unrecoverable, so
        // this screen must not be something the person can navigate past.
        setStep("backup");
      } else if (res.status === 429) {
        setError("Too many codes tried. Please wait a few minutes and try again.");
      } else {
        setError("That code didn't work. Codes change every 30 seconds, so try the current one.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/password/change-required", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingToken, newPassword: newPassword.password }),
      });
      const data = await res.json();
      if (res.ok) {
        // This endpoint deliberately mints no session: sign in again with the
        // new password.
        setStep("credentials");
        setForm({ identifier: form.identifier, password: "" });
        setNewPassword({ password: "", confirm: "" });
        setNotice("Password set. Sign in with your new password.");
      } else if (res.status === 400 && Array.isArray(data.problems) && data.problems.length > 0) {
        setError(`Your password must: ${(data.problems as string[]).join(" ")}`);
      } else {
        setError("That link has expired. Sign in again to get a fresh one.");
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

      {notice && step === "credentials" && (
        <p className="text-sm text-sage font-medium mb-6">{notice}</p>
      )}

      {step === "credentials" && (
        <form className="space-y-6" onSubmit={handleCredentials}>
          <div>
            <label className="label block mb-2" htmlFor="identifier">
              Email or username
            </label>
            <input
              id="identifier"
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
            <label className="label block mb-2" htmlFor="password">
              Password
            </label>
            <input
              id="password"
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
          <p className="text-sm">
            <Link href="/forgot-password" className="text-coral font-medium hover:underline">
              Forgot password?
            </Link>
          </p>
        </form>
      )}

      {step === "totp" && (
        <form className="space-y-6" onSubmit={handleTotp}>
          <p className="text-sm text-muted">
            Enter the 6-digit code from your authenticator app, or a backup code.
          </p>
          <div>
            <label className="label block mb-2" htmlFor="totp-code">
              Authentication code
            </label>
            <input
              id="totp-code"
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

      {step === "enroll" && enrollment !== null && (
        <TotpEnrollment
          secret={enrollment.secret}
          otpauthUri={enrollment.otpauthUri}
          busy={busy}
          error={error}
          onConfirm={handleConfirmEnrollment}
        />
      )}

      {step === "backup" && <BackupCodes codes={backupCodes} onDone={() => goToPortal(next)} />}

      {step === "changePassword" && (
        <form className="space-y-6" onSubmit={handlePasswordChange}>
          <p className="text-sm text-muted">
            This account is using a temporary password. Choose your own before continuing.
          </p>
          <NewPasswordFields value={newPassword} onChange={setNewPassword} disabled={busy} autoFocus />
          <button
            type="submit"
            disabled={busy || !newPasswordReady(newPassword)}
            className="w-full bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors disabled:opacity-50"
          >
            {busy ? "Saving…" : "Set password"}
          </button>
        </form>
      )}

      {/* The enrollment step renders its own error inline, next to the field it
          belongs to; everything else shares this one. */}
      {error && step !== "enroll" && <p className="text-sm text-coral font-medium mt-4">{error}</p>}

      {step === "credentials" && (
        <p className="text-sm text-muted mt-8">
          New to CurioLab?{" "}
          <Link href="/contact" className="text-coral font-medium hover:underline">
            Contact for support or apply →
          </Link>
        </p>
      )}
    </div>
  );
}
