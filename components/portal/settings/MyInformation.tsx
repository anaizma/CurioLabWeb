"use client";

import { Fragment, useState } from "react";
import type { InfoField, MyInfoView, NotificationEmailModel } from "@/lib/portal/settings/my-info-data";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function MyInformation({ view }: { view: MyInfoView }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const valueOf = (f: InfoField) => values[f.key] ?? f.value;

  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      <div>
        <h2 className="text-lg font-bold">My information</h2>
        <p className="text-ink/60 text-sm mt-0.5">Everything CurioLab has on file for you. Only your email{view.role === "student" ? " and school" : ""} can be changed.</p>
      </div>

      <div className="rounded-sm border px-4 py-3 text-[13px] flex items-start gap-2.5" style={{ borderColor: "var(--pt-accent-border)", background: "var(--pt-accent-soft)", color: "var(--pt-accent-fg)" }}>
        <span aria-hidden className="mt-0.5">ⓘ</span>
        <p>
          {view.emailLive
            ? "Your email is connected to your account. Your other details are examples until the rest of account settings connects."
            : "Showing example data. Your real details load once account settings connect; edits here are saved on this page for now."}
        </p>
      </div>

      {view.sections.map((section, idx) => (
        <Fragment key={section.title}>
          <section className="rounded-sm border border-ink/10 bg-white overflow-hidden">
            <div className="label text-[10.5px] px-4 pt-3.5 pb-2 border-b border-ink/[.06]">{section.title}</div>
            <div className="divide-y divide-ink/[.05]">
              {section.fields.map((f) => (
                <FieldRow key={f.key} field={f} value={valueOf(f)} onSave={(v) => setValues((p) => ({ ...p, [f.key]: v }))} />
              ))}
            </div>
          </section>
          {idx === 0 && view.notificationEmail && <EmailSection model={view.notificationEmail} live={view.emailLive} />}
        </Fragment>
      ))}
    </div>
  );
}

// ---- generic read-only / simple-editable field ----------------------------

function FieldRow({ field, value, onSave }: { field: InfoField; value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function begin() {
    setDraft(value);
    setError(null);
    setSaved(false);
    setEditing(true);
  }
  function commit() {
    const v = draft.trim();
    if (field.kind === "email" && !EMAIL_RE.test(v)) { setError("Enter a valid email address."); return; }
    if (!v) { setError("This can't be empty."); return; }
    onSave(v);
    setEditing(false);
    setSaved(true);
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="label text-[10px] text-ink/40">{field.label}</div>
          {editing ? (
            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
              <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }} type={field.kind === "email" ? "email" : "text"} autoFocus className="rounded-md border border-ink/20 px-2.5 py-1.5 text-sm bg-white min-w-[16rem] max-w-full focus:outline-none focus:border-[color:var(--pt-accent)]" />
              <button type="button" onClick={commit} className="rounded-md px-3 py-1.5 text-xs font-semibold text-white" style={{ background: "var(--pt-accent)" }}>Save</button>
              <button type="button" onClick={() => setEditing(false)} className="rounded-md px-2.5 py-1.5 text-xs font-semibold text-ink/50 hover:text-ink">Cancel</button>
            </div>
          ) : (
            <div className="mt-0.5 text-sm flex items-center gap-2 flex-wrap">
              <span className={field.kind === "email" ? "font-mono text-[13px]" : ""}>{value || "—"}</span>
              {saved && <span className="text-[11px]" style={{ color: "var(--pt-accent)" }}>Saved</span>}
            </div>
          )}
          {error && <p className="text-[11px] text-red-500 mt-1">{error}</p>}
          {field.note && !editing && <p className="text-[11.5px] text-ink/45 mt-1">{field.note}</p>}
        </div>
        {field.editable && !field.frozen && !editing && (
          <button type="button" onClick={begin} className="shrink-0 text-xs font-semibold" style={{ color: "var(--pt-accent)" }}>Edit</button>
        )}
      </div>
    </div>
  );
}

// ---- student notification-email pair (live GET/PUT) ------------------------

function EmailSection({ model, live }: { model: NotificationEmailModel; live: boolean }) {
  const [m, setM] = useState(model);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const guardianEmail = m.primary.isOwn ? m.secondary.email : m.primary.email;

  async function put(email: string | null) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      if (email !== null && !EMAIL_RE.test(email)) { setError("Enter a valid email address."); return; }
      if (live) {
        const res = await fetch("/api/portal/student/notification-email", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email }),
        });
        if (res.status === 400) { setError("Enter a valid email address."); return; }
        if (res.status === 403) { setError("You're not able to change this email."); return; }
        if (!res.ok) { setError("Couldn't save — please try again."); return; }
        const next = (await res.json()) as NotificationEmailModel;
        setM({
          primary: { email: next.primary?.email ?? null, isOwn: !!next.primary?.isOwn, editable: !!next.primary?.editable },
          secondary: { email: next.secondary?.email ?? null, editable: false },
        });
      } else {
        // representative optimistic update mirroring the endpoint's behavior
        if (email === null) setM({ primary: { email: guardianEmail, isOwn: false, editable: true }, secondary: { email: null, editable: false } });
        else setM({ primary: { email, isOwn: true, editable: true }, secondary: { email: guardianEmail, editable: false } });
      }
      setEditing(false);
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  function begin() {
    setDraft(m.primary.isOwn ? m.primary.email ?? "" : "");
    setError(null);
    setSaved(false);
    setEditing(true);
  }

  return (
    <section className="rounded-sm border border-ink/10 bg-white overflow-hidden">
      <div className="label text-[10.5px] px-4 pt-3.5 pb-2 border-b border-ink/[.06]">Email</div>
      <div className="divide-y divide-ink/[.05]">
        {/* Primary */}
        <div className="px-4 py-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="label text-[10px] text-ink/40">Primary email</div>
              {editing ? (
                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                  <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void put(draft.trim()); if (e.key === "Escape") setEditing(false); }} type="email" placeholder="you@example.com" autoFocus className="rounded-md border border-ink/20 px-2.5 py-1.5 text-sm bg-white min-w-[16rem] max-w-full focus:outline-none focus:border-[color:var(--pt-accent)]" />
                  <button type="button" onClick={() => void put(draft.trim())} disabled={busy} className="rounded-md px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" style={{ background: "var(--pt-accent)" }}>Save</button>
                  <button type="button" onClick={() => setEditing(false)} className="rounded-md px-2.5 py-1.5 text-xs font-semibold text-ink/50 hover:text-ink">Cancel</button>
                </div>
              ) : (
                <div className="mt-0.5 text-sm flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[13px]">{m.primary.email || "—"}</span>
                  {!m.primary.editable && <span className="text-[10px] font-mono uppercase tracking-wide rounded px-1.5 py-0.5 bg-ink/5 text-ink/50">🔒 Locked</span>}
                  {saved && <span className="text-[11px]" style={{ color: "var(--pt-accent)" }}>Saved</span>}
                </div>
              )}
              {error && <p className="text-[11px] text-red-500 mt-1">{error}</p>}
              {!editing && (
                <p className="text-[11.5px] text-ink/45 mt-1">
                  {!m.primary.editable
                    ? "Managed through your guardian. You'll be able to set your own email at 13."
                    : m.primary.isOwn
                    ? "Notifications come straight to you. You can update it or switch back to your guardian's email."
                    : "You're using your guardian's email. Add your own to get notified directly."}
                </p>
              )}
            </div>
            {m.primary.editable && !editing && (
              <div className="shrink-0 flex flex-col items-end gap-1">
                <button type="button" onClick={begin} className="text-xs font-semibold" style={{ color: "var(--pt-accent)" }}>{m.primary.isOwn ? "Edit" : "Add your email"}</button>
                {m.primary.isOwn && <button type="button" onClick={() => void put(null)} disabled={busy} className="text-[11px] font-semibold text-ink/45 hover:text-ink disabled:opacity-50">Use guardian&apos;s email</button>}
              </div>
            )}
          </div>
        </div>

        {/* Secondary (parent slot — never student-editable) */}
        <div className="px-4 py-3">
          <div className="label text-[10px] text-ink/40">Secondary email</div>
          <div className="mt-0.5 text-sm flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[13px]">{m.secondary.email || "—"}</span>
            <span className="text-[10px] font-mono uppercase tracking-wide rounded px-1.5 py-0.5 bg-ink/5 text-ink/50">🔒 Guardian</span>
          </div>
          <p className="text-[11.5px] text-ink/45 mt-1">
            {m.secondary.email
              ? "Your guardian's email — always kept in sync with your current guardian and never editable here."
              : "Set your own primary email and your guardian's stays here as the secondary."}
          </p>
        </div>
      </div>
    </section>
  );
}
