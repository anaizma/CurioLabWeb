"use client";

import { useState } from "react";
import TurnstileWidget from "@/components/TurnstileWidget";

export default function ContactClient({ siteKey }: { siteKey: string | null }) {
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState(
    "Something went wrong. Please email us directly at team@acuriolab.org.",
  );
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  const awaitingBotCheck = siteKey !== null && turnstileToken === null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, turnstileToken }),
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
            "You've sent a few messages already. Please wait a little while, or email us directly at team@acuriolab.org.",
          );
        } else {
          setErrorMessage("Something went wrong. Please email us directly at team@acuriolab.org.");
        }
        throw new Error("Request failed");
      }
      setStatus("sent");
      setForm({ name: "", email: "", message: "" });
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-20">
      <p className="label-blue mb-3">Get in touch</p>
      <h1 className="text-3xl md:text-5xl font-bold mb-6">Contact</h1>
      <p className="text-black max-w-xl mb-12">
        Questions about applying, mentoring, sponsoring, or starting a chapter?
        Reach out and a real person will get back to you.
      </p>

      <div className="grid md:grid-cols-2 gap-8 mb-16">
        <div className="bg-white border border-black/10 rounded-xl p-6">
          <p className="label mb-2">Email</p>
          <a href="mailto:team@acuriolab.org" className="font-medium hover:underline">
            team@acuriolab.org
          </a>
        </div>
        <div className="bg-white border border-black/10 rounded-xl p-6">
          <p className="label mb-2">Locations</p>
          <p className="font-medium">Cleveland, OH</p>
        </div>
      </div>

      <form className="space-y-6" onSubmit={handleSubmit}>
        <div>
          <label className="label block mb-2">Name</label>
          <input
            className="w-full border border-black/20 rounded-md px-4 py-3 bg-white"
            type="text"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div>
          <label className="label block mb-2">Email</label>
          <input
            className="w-full border border-black/20 rounded-md px-4 py-3 bg-white"
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
        <div>
          <label className="label block mb-2">Message</label>
          <textarea
            className="w-full border border-black/20 rounded-md px-4 py-3 bg-white"
            rows={5}
            required
            value={form.message}
            onChange={(e) => setForm({ ...form, message: e.target.value })}
          />
        </div>
        <TurnstileWidget siteKey={siteKey} onToken={setTurnstileToken} />
        <button
          type="submit"
          disabled={status === "sending" || awaitingBotCheck}
          className="bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors disabled:opacity-50"
        >
          {status === "sending" ? "Sending…" : awaitingBotCheck ? "Just a moment…" : "Send message"}
        </button>
        {status === "sent" && (
          <p className="text-sm text-sage font-medium">
            Message sent. We&apos;ll get back to you soon.
          </p>
        )}
        {status === "error" && <p className="text-sm text-coral font-medium">{errorMessage}</p>}
      </form>
    </div>
  );
}