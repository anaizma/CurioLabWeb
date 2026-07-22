"use client";

import Link from "next/link";
import { useState } from "react";

export default function SignupPage() {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [submitted, setSubmitted] = useState(false);

  return (
    <div className="mx-auto max-w-md px-6 py-20">
      <p className="label-blue mb-3">Get started</p>
      <h1 className="text-3xl md:text-4xl font-bold mb-8">Make an account</h1>

      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(true);
        }}
      >
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
          <label className="label block mb-2">Password</label>
          <input
            className="w-full border border-black/20 rounded-md px-4 py-3 bg-white"
            type="password"
            required
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </div>
        <button
          type="submit"
          className="w-full bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors"
        >
          Make an account
        </button>
      </form>

      {submitted && (
        <p className="text-sm text-sage font-medium mt-4">
          Accounts aren&apos;t live yet — sign up will be available soon.
        </p>
      )}

      <p className="text-xs text-muted mt-6">
        Backend currently being worked on, will be deployed and live soon.
      </p>

      <p className="text-sm text-muted mt-8">
        Already have an account?{" "}
        <Link href="/login" className="text-coral font-medium hover:underline">
          Log in →
        </Link>
      </p>
    </div>
  );
}
