"use client";

// Request a password reset.
//
// THE RESPONSE IS UNIFORM ON PURPOSE. Whether or not the address belongs to an
// account, this form says the same thing: "if that address has an account, a link
// is on its way". The backend is built the same way (POST
// /api/auth/password/reset-request returns 202 in every branch and swallows a
// send failure), and this screen must not undo that by showing a different
// message for a real address. An account-existence oracle on a platform whose
// users are children and their guardians is a genuine privacy leak, not a
// theoretical one.
//
// The two failure states it DOES distinguish are the ones that say nothing about
// the account: the bot check refused (403) and the throttle refused (429).

import Link from "next/link";
import { useState } from "react";
import TurnstileWidget from "@/components/TurnstileWidget";

export default function ForgotPasswordClient({ siteKey }: { siteKey: string | null }) {
  const [identifier, setIdentifier] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  const awaitingBotCheck = siteKey !== null && turnstileToken === null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMessage("");
    try {
      const res = await fetch("/api/auth/password/reset-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `identifier` is what the controller reads (an account resolves by email
        // OR username); `email` keys the per-account throttle bucket.
        body: JSON.stringify({ identifier, email: identifier, turnstileToken }),
      });
      if (!res.ok) {
        // A Turnstile token is single-use, so drop it and let the widget reissue.
        setTurnstileToken(null);
        if (res.status === 403) {
          setErrorMessage(
            "We couldn't complete the security check. Please wait a moment for it to finish, then try again.",
          );
        } else if (res.status === 429) {
          setErrorMessage(
            "Too many reset requests. Please wait a little while before trying again.",
          );
        } else {
          setErrorMessage("Something went wrong. Please try again in a moment.");
        }
        setStatus("error");
        return;
      }
      setStatus("sent");
    } catch {
      setErrorMessage("Something went wrong. Please try again in a moment.");
      setStatus("error");
    }
  }

  return (
    <div className="mx-auto max-w-md px-6 py-20">
      <p className="label-blue mb-3">Account help</p>
      <h1 className="text-3xl md:text-4xl font-bold mb-6">Forgot your password?</h1>

      {status === "sent" ? (
        <>
          <p className="text-black mb-6">
            If that address has a CurioLab account, a reset link is on its way. It works once and
            expires in about an hour.
          </p>
          <p className="text-sm text-muted mb-8">
            Nothing arrived? Check your spam folder, then try again. Students sign in with a username
            rather than an email address, so a student account is reset by a parent or the chapter
            director rather than from here.
          </p>
          <Link href="/login" className="text-coral font-medium hover:underline">
            Back to log in →
          </Link>
        </>
      ) : (
        <>
          <p className="text-black mb-8">
            Enter the email address on your account and we&apos;ll send you a link to set a new
            password.
          </p>
          <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label className="label block mb-2" htmlFor="reset-identifier">
                Email address
              </label>
              <input
                id="reset-identifier"
                className="w-full border border-black/20 rounded-md px-4 py-3 bg-white"
                type="text"
                autoComplete="username"
                placeholder="you@example.com"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
              />
            </div>
            <TurnstileWidget siteKey={siteKey} onToken={setTurnstileToken} />
            <button
              type="submit"
              disabled={status === "sending" || awaitingBotCheck}
              className="w-full bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors disabled:opacity-50"
            >
              {status === "sending"
                ? "Sending…"
                : awaitingBotCheck
                  ? "Just a moment…"
                  : "Send reset link"}
            </button>
            {status === "error" && <p className="text-sm text-coral font-medium">{errorMessage}</p>}
          </form>
          <p className="text-sm text-muted mt-8">
            Remembered it?{" "}
            <Link href="/login" className="text-coral font-medium hover:underline">
              Back to log in →
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
