"use client";

import { useState } from "react";

export default function NewsletterPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  return (
    <div className="mx-auto max-w-3xl px-6 py-20">
      <p className="label-blue mb-3">Stay in the loop</p>
      <h1 className="text-3xl md:text-5xl font-bold mb-6">Newsletter</h1>
      <p className="text-black max-w-xl mb-12">
        Updates on student projects, new cohorts, mentor openings, and what the
        CurioLab community is building — a few times a semester, no spam.
      </p>

      <form
        className="flex flex-col sm:flex-row gap-3 max-w-xl"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(true);
        }}
      >
        <input
          className="flex-1 border border-black/20 rounded-md px-4 py-3 bg-white"
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button
          type="submit"
          className="bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors"
        >
          Subscribe
        </button>
      </form>

      {submitted && (
        <p className="text-sm text-sage font-medium mt-4">
          Thanks for signing up! Our newsletter isn&apos;t live yet — we&apos;ll
          add you as soon as it is.
        </p>
      )}

      <p className="text-xs text-muted mt-6">
        Backend currently being worked on, will be deployed and live soon.
      </p>
    </div>
  );
}
