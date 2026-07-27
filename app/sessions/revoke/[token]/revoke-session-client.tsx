"use client";

import Link from "next/link";
import { useState } from "react";

export default function RevokeSessionClient({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");

  async function revoke() {
    setState("working");
    try {
      const res = await fetch("/api/auth/sessions/revoke-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      // The endpoint answers the same way for an unknown, used, or live token, so
      // "done" here means "that session is not live", which is what the person
      // came to find out.
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="mx-auto max-w-md px-6 py-20">
      <p className="label-blue mb-3">Account security</p>
      <h1 className="text-3xl md:text-4xl font-bold mb-6">End that session?</h1>

      {state === "done" ? (
        <>
          <p className="text-black mb-6">
            That session has been ended. Whoever was using it has been signed out.
          </p>
          <p className="text-sm text-muted mb-8">
            Change your password next. If your account uses an authenticator app, whoever signed in
            also had a valid code, so treat the device holding it as compromised and re-enroll.
          </p>
          <Link
            href="/forgot-password"
            className="inline-block bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors"
          >
            Change my password
          </Link>
        </>
      ) : (
        <>
          <p className="text-black mb-8">
            This will sign out the device named in the email we sent you. Nothing else changes, and
            you will stay signed in everywhere else.
          </p>
          <button
            type="button"
            onClick={revoke}
            disabled={state === "working"}
            className="w-full bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors disabled:opacity-50"
          >
            {state === "working" ? "Ending session…" : "End that session"}
          </button>
          {state === "error" && (
            <p className="text-sm text-coral font-medium mt-4">
              Something went wrong. Sign in and end the session from Settings, under Account &amp;
              security.
            </p>
          )}
        </>
      )}
    </div>
  );
}
