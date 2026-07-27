"use client";

// The new-password form behind a validated reset link.
//
// The policy shown under the field is the same module the service enforces
// (@curiolab/core password-policy), so the form cannot accept something the
// server will refuse. The server still checks: this is a convenience, not the
// enforcement.
//
// On success the backend has already revoked every session for the account, so
// this sends the person to /login rather than into a portal. Being signed out
// everywhere is the point of a reset, and quietly signing them straight back in
// would hide it.

import { useState } from "react";
import NewPasswordFields, { newPasswordReady, type NewPasswordState } from "@/components/auth/NewPasswordFields";

export default function ResetPasswordClient({ token }: { token: string }) {
  const [value, setValue] = useState<NewPasswordState>({ password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: value.password }),
      });
      const data = await res.json();
      if (res.ok) {
        // Every session was revoked by the reset, so sign-in is the only next
        // step. `reset=1` makes the login page confirm the change took effect.
        window.location.assign("/login?reset=1");
        return;
      }
      if (res.status === 401) {
        // The token lapsed or was used between the page render and this submit.
        setExpired(true);
      } else if (res.status === 400 && Array.isArray(data.problems) && data.problems.length > 0) {
        setError(`Your password must: ${(data.problems as string[]).join(" ")}`);
      } else {
        setError("Something went wrong. Please try again in a moment.");
      }
    } catch {
      setError("Something went wrong. Please try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  if (expired) {
    return (
      <div className="mx-auto max-w-md px-6 py-20">
        <p className="label-blue mb-3">Account help</p>
        <h1 className="text-3xl md:text-4xl font-bold mb-6">This link has expired</h1>
        <p className="text-black mb-8">
          It was used or it timed out while this page was open. Your password has not changed.
        </p>
        <a
          href="/forgot-password"
          className="inline-block bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors"
        >
          Send a new link
        </a>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-6 py-20">
      <p className="label-blue mb-3">Account help</p>
      <h1 className="text-3xl md:text-4xl font-bold mb-6">Set a new password</h1>
      <p className="text-black mb-8">
        Choose a new password for your CurioLab account. Everywhere you are currently signed in will
        be signed out.
      </p>
      <form className="space-y-6" onSubmit={handleSubmit}>
        <NewPasswordFields value={value} onChange={setValue} disabled={busy} autoFocus />
        <button
          type="submit"
          disabled={busy || !newPasswordReady(value)}
          className="w-full bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors disabled:opacity-50"
        >
          {busy ? "Saving…" : "Set new password"}
        </button>
        {error && <p className="text-sm text-coral font-medium">{error}</p>}
      </form>
    </div>
  );
}
