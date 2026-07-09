"use client";

import { useState } from "react";

export default function ContactPage() {
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Request failed");
      setStatus("sent");
      setForm({ name: "", email: "", message: "" });
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-20">
      <p className="label mb-3">Get in touch</p>
      <h1 className="text-3xl md:text-5xl font-bold mb-6">Contact</h1>
      <p className="text-muted max-w-xl mb-12">
        Questions about applying, mentoring, sponsoring, or starting a
        chapter — reach out and a real person will get back to you.
      </p>

      <div className="grid md:grid-cols-2 gap-8 mb-16">
        <div className="bg-white border border-black/10 rounded-xl p-6">
          <p className="label mb-2">Email</p>
          <a href="mailto:aizma@acuriolab.org" className="font-medium hover:underline">
            aizma@acuriolab.org
          </a>
        </div>
        <div className="bg-white border border-black/10 rounded-xl p-6">
          <p className="label mb-2">Locations</p>
          <p className="font-medium">Tucker, GA & Cleveland, OH</p>
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
        <button
          type="submit"
          disabled={status === "sending"}
          className="bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors disabled:opacity-50"
        >
          {status === "sending" ? "Sending…" : "Send message"}
        </button>
        {status === "sent" && (
          <p className="text-sm text-sage font-medium">
            Message sent — we'll get back to you soon.
          </p>
        )}
        {status === "error" && (
          <p className="text-sm text-coral font-medium">
            Something went wrong. Please email us directly at aizma@acuriolab.org.
          </p>
        )}
      </form>
    </div>
  );
}