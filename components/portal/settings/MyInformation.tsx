"use client";

import { useState } from "react";
import type { InfoField, MyInfoView } from "@/lib/portal/settings/my-info-data";

export default function MyInformation({ view }: { view: MyInfoView }) {
  // Local optimistic overrides for editable fields (no update endpoint yet).
  const [values, setValues] = useState<Record<string, string>>({});

  function valueOf(f: InfoField): string {
    return values[f.key] ?? f.value;
  }

  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      <div>
        <h2 className="text-lg font-bold">My information</h2>
        <p className="text-ink/60 text-sm mt-0.5">Everything CurioLab has on file for you. Only your email{view.role === "student" ? " and school" : ""} can be changed.</p>
      </div>

      <div className="rounded-sm border px-4 py-3 text-[13px] flex items-start gap-2.5" style={{ borderColor: "var(--pt-accent-border)", background: "var(--pt-accent-soft)", color: "var(--pt-accent-fg)" }}>
        <span aria-hidden className="mt-0.5">ⓘ</span>
        <p>Showing example data. Your real details load once account settings connect to the backend; edits here are saved on this page for now.</p>
      </div>

      {view.sections.map((section) => (
        <section key={section.title} className="rounded-sm border border-ink/10 bg-white overflow-hidden">
          <div className="label text-[10.5px] px-4 pt-3.5 pb-2 border-b border-ink/[.06]">{section.title}</div>
          <div className="divide-y divide-ink/[.05]">
            {section.fields.map((f) => (
              <FieldRow key={f.key} field={f} value={valueOf(f)} onSave={(v) => setValues((p) => ({ ...p, [f.key]: v }))} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

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
    if (field.kind === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
      setError("Enter a valid email address.");
      return;
    }
    if (!v) {
      setError("This can't be empty.");
      return;
    }
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
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
                type={field.kind === "email" ? "email" : "text"}
                autoFocus
                className="rounded-md border border-ink/20 px-2.5 py-1.5 text-sm bg-white min-w-[16rem] max-w-full focus:outline-none focus:border-[color:var(--pt-accent)]"
              />
              <button type="button" onClick={commit} className="rounded-md px-3 py-1.5 text-xs font-semibold text-white" style={{ background: "var(--pt-accent)" }}>Save</button>
              <button type="button" onClick={() => setEditing(false)} className="rounded-md px-2.5 py-1.5 text-xs font-semibold text-ink/50 hover:text-ink">Cancel</button>
            </div>
          ) : (
            <div className="mt-0.5 text-sm flex items-center gap-2 flex-wrap">
              <span className={`${field.frozen ? "text-ink/60" : ""} ${field.kind === "email" ? "font-mono text-[13px]" : ""}`}>{value || "—"}</span>
              {field.frozen && <span className="text-[10px] font-mono uppercase tracking-wide rounded px-1.5 py-0.5 bg-ink/5 text-ink/50">🔒 Locked</span>}
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
