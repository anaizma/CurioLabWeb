"use client";

import { useState } from "react";

type Kind = "guardian" | "student" | "mentor" | "staff";
const inputCls = "w-full rounded-lg border border-ink/15 px-3 py-2 text-sm bg-white";

export default function AcceptClient({ token, kind, chapter }: { token: string; kind: Kind; chapter: string | null }) {
  const isStudent = kind === "student";
  const [form, setForm] = useState({ email: "", username: "", password: "", legalName: "", displayName: "", dateOfBirth: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const endpoint = isStudent ? `/api/invites/${token}/accept-student` : `/api/invites/${token}/accept`;
    const body = isStudent
      ? { username: form.username, password: form.password, legalName: form.legalName, displayName: form.displayName }
      : {
          email: form.email,
          password: form.password,
          legalName: form.legalName,
          displayName: form.displayName,
          dateOfBirth: form.dateOfBirth,
        };
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (res.status === 201) {
        setDone(true);
        return;
      }
      if (res.status === 400) setError("Please check the form — a field is missing or doesn't match the invite.");
      else if (res.status === 401) setError("This invite is no longer valid.");
      else if (res.status === 404) setError("We couldn't find this invite.");
      else setError("Something went wrong — please try again.");
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-ink/10 bg-white p-8 text-center">
        <h1 className="text-xl font-bold">Account created</h1>
        <p className="text-ink/60 text-sm mt-2">
          Your account is pending activation by the Chapter Director. You&apos;ll be able to sign in once it&apos;s active.
          {kind === "guardian" ? " After that, you can invite your student from your parent portal." : ""}
        </p>
      </div>
    );
  }

  const kindLabel = kind === "guardian" ? "guardian" : kind === "student" ? "student" : kind === "mentor" ? "mentor" : "staff";
  return (
    <form onSubmit={submit} className="rounded-2xl border border-ink/10 bg-white p-8 flex flex-col gap-4">
      <div>
        <div className="label text-[11px] uppercase tracking-wide text-ink/40">CurioLab{chapter ? ` · ${chapter}` : ""}</div>
        <h1 className="text-xl font-bold mt-1">Create your {kindLabel} account</h1>
      </div>

      {isStudent ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/60">Username</span>
          <input className={inputCls} value={form.username} onChange={set("username")} required autoComplete="username" />
        </label>
      ) : (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/60">Email</span>
          <input className={inputCls} type="email" value={form.email} onChange={set("email")} required autoComplete="email" />
        </label>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink/60">Password</span>
        <input className={inputCls} type="password" value={form.password} onChange={set("password")} required autoComplete="new-password" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink/60">Legal name</span>
        <input className={inputCls} value={form.legalName} onChange={set("legalName")} required />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink/60">Display name</span>
        <input className={inputCls} value={form.displayName} onChange={set("displayName")} required />
      </label>
      {!isStudent && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/60">Date of birth</span>
          <input className={inputCls} type="date" value={form.dateOfBirth} onChange={set("dateOfBirth")} required />
        </label>
      )}

      {error && <p className="text-xs text-coral">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
        style={{ background: "var(--pt-accent)", color: "var(--pt-on-accent)" }}
      >
        {busy ? "Creating…" : "Create account"}
      </button>
    </form>
  );
}
