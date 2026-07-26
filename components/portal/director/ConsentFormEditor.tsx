"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import FormViewer from "@/components/portal/guardian/FormViewer";
// Type-only import: the data module depends on next/headers (server-only), so the
// client bundle must not pull its runtime values. The audience/grant/locked
// constants are re-declared locally below to match the backend exactly.
import type {
  EditableConsentForm,
  EditableField,
  EditableFieldInputType,
  EditableItem,
  FormAudience,
} from "@/lib/portal/director/consent-forms-data";

// ---- local constants (mirror the server module + backend) -----------------

const AUDIENCES: FormAudience[] = ["guardian", "mentor", "student"];
const AUDIENCE_LABELS: Record<FormAudience, string> = {
  guardian: "Guardian",
  mentor: "Mentor",
  student: "Student",
};

const INPUT_TYPES: EditableFieldInputType[] = ["text", "date", "tel", "email", "signature"];
const INPUT_TYPE_LABELS: Record<EditableFieldInputType, string> = {
  text: "Text",
  date: "Date",
  tel: "Phone",
  email: "Email",
  signature: "Signature",
};

const GRANT_MAPPINGS = [
  "program_participation",
  "platform_account",
  "public_publication",
  "photo_video_likeness",
  "emergency_medical_pickup",
  "verification_link_sharing",
  "mentor_dm",
  "student_notification_email",
] as const;
const GRANT_LABELS: Record<string, string> = {
  program_participation: "Program participation",
  platform_account: "Platform account",
  public_publication: "Public publication",
  photo_video_likeness: "Photo / video likeness",
  emergency_medical_pickup: "Emergency medical / pickup",
  verification_link_sharing: "Verification-link sharing",
  mentor_dm: "Mentor DM",
  student_notification_email: "Student notification email",
};

// Locked default detail fields per audience — hardcoded to match the backend.
const LOCKED_FIELDS: Record<FormAudience, EditableField[]> = {
  guardian: [
    { fieldType: "guardian_name", label: "Guardian name", inputType: "text", required: true, fixed: true },
    { fieldType: "relationship", label: "Relationship to child", inputType: "text", required: true, fixed: true },
    { fieldType: "date", label: "Date", inputType: "date", required: true, fixed: true },
    { fieldType: "signature", label: "Signature", inputType: "signature", required: true, fixed: true },
  ],
  mentor: [
    { fieldType: "mentor_name", label: "Mentor name", inputType: "text", required: true, fixed: true },
    { fieldType: "date", label: "Date", inputType: "date", required: true, fixed: true },
    { fieldType: "signature", label: "Signature", inputType: "signature", required: true, fixed: true },
  ],
  student: [
    { fieldType: "student_name", label: "Student name", inputType: "text", required: true, fixed: true },
    { fieldType: "date", label: "Date", inputType: "date", required: true, fixed: true },
    { fieldType: "signature", label: "Signature", inputType: "signature", required: true, fixed: true },
  ],
};
function lockedFieldsFor(a: FormAudience): EditableField[] {
  return LOCKED_FIELDS[a].map((f) => ({ ...f }));
}

// ---- helpers --------------------------------------------------------------

function randomSlug(): string {
  try {
    return crypto.randomUUID().slice(0, 8);
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
}

/** Slug a label into a backend-safe fieldType (must match /^[a-zA-Z][a-zA-Z0-9_]*$/). */
function slugField(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  if (!base) return `field_${randomSlug()}`;
  return /^[a-z]/.test(base) ? base : `f_${base}`;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

// ---- component ------------------------------------------------------------

export default function ConsentFormEditor({
  initial,
  mode,
}: {
  initial: EditableConsentForm;
  mode: "edit" | "create";
}) {
  const router = useRouter();
  const itemSeq = useRef(0);

  const [audience, setAudience] = useState<FormAudience>(initial.audience);
  const [title, setTitle] = useState(initial.title);
  const [documentId, setDocumentId] = useState(initial.documentId);
  const [elevated, setElevated] = useState(initial.elevated);
  const [items, setItems] = useState<EditableItem[]>(initial.items.map((it) => ({ ...it })));
  const [fields, setFields] = useState<EditableField[]>(initial.fields.map((f) => ({ ...f })));

  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [pdfFileName, setPdfFileName] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const needsPdf = mode === "create" && !pdfBase64;

  // ---- item mutators ----
  function newItemKey(): string {
    itemSeq.current += 1;
    const prefix = initial.formKey || audience;
    return `${prefix}:item-new-${itemSeq.current}-${randomSlug()}`;
  }
  function addItem() {
    setItems((prev) => [
      ...prev,
      { itemKey: newItemKey(), text: "", required: true, elevated: false, grantMapping: null },
    ]);
  }
  function updateItem(i: number, patch: Partial<EditableItem>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function removeItem(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }
  function moveItem(i: number, dir: -1 | 1) {
    setItems((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  // ---- field mutators ----
  function addField() {
    setFields((prev) => [
      ...prev,
      { fieldType: "", label: "", inputType: "text", required: false, fixed: false },
    ]);
  }
  function updateField(i: number, patch: Partial<EditableField>) {
    setFields((prev) =>
      prev.map((f, idx) => {
        if (idx !== i) return f;
        const next = { ...f, ...patch };
        // Auto-slug the key from the label while the director hasn't set one.
        if (patch.label !== undefined && !f.fixed && (f.fieldType === "" || f.fieldType === slugField(f.label))) {
          next.fieldType = slugField(patch.label);
        }
        return next;
      }),
    );
  }
  function removeField(i: number) {
    setFields((prev) => prev.filter((_, idx) => idx !== i));
  }

  // ---- audience change (create mode): swap locked defaults ----
  function changeAudience(next: FormAudience) {
    setFields((prev) => [...lockedFieldsFor(next), ...prev.filter((f) => !f.fixed)]);
    setAudience(next);
  }

  // ---- pdf ----
  async function onPickPdf(file: File | undefined) {
    setPdfError(null);
    if (!file) {
      setPdfBase64(null);
      setPdfFileName(null);
      return;
    }
    if (file.type && file.type !== "application/pdf") {
      setPdfError("Please choose a PDF file.");
      return;
    }
    try {
      const b64 = await readFileAsBase64(file);
      if (!b64) {
        setPdfError("That file appears to be empty.");
        return;
      }
      setPdfBase64(b64);
      setPdfFileName(file.name);
    } catch {
      setPdfError("Could not read that file. Try again.");
    }
  }

  // ---- validation + save ----
  function validate(): string | null {
    if (!title.trim()) return "Give the form a title.";
    for (const it of items) {
      if (!it.text.trim()) return "Every checkbox item needs some text.";
    }
    const seen = new Set<string>();
    for (const f of fields) {
      if (!f.label.trim()) return "Every detail field needs a label.";
      const key = f.fieldType.trim();
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) {
        return `Field key “${key || "(empty)"}” must start with a letter and use only letters, numbers or underscores.`;
      }
      if (seen.has(key)) return `Field key “${key}” is used more than once.`;
      seen.add(key);
    }
    if (needsPdf) return "Upload a PDF document for the new form.";
    return null;
  }

  async function save(publish: boolean) {
    setNotice(null);
    const problem = validate();
    if (problem) {
      setNotice({ kind: "err", text: problem });
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        audience,
        title: title.trim(),
        documentId: documentId.trim(),
        elevated,
        items: items.map((it) => ({
          itemKey: it.itemKey,
          text: it.text,
          required: it.required,
          elevated: it.elevated,
          grantMapping: it.grantMapping && it.grantMapping !== "none" ? it.grantMapping : null,
        })),
        fields: fields.map((f) => ({
          fieldType: f.fieldType.trim(),
          label: f.label,
          inputType: f.inputType,
          required: f.required,
        })),
        pdfBase64: pdfBase64 ?? undefined,
        publish,
      };
      const key = initial.formKey || slugField(title);
      const res = await fetch(`/api/ops/consent-forms/${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setNotice({ kind: "err", text: friendlyError(res.status) });
        return;
      }
      const out = (await res.json().catch(() => ({}))) as { formKey?: string; version?: number; status?: string };
      setNotice({
        kind: "ok",
        text: publish
          ? `Published version ${out.version ?? ""}.`.trim()
          : `Draft saved (version ${out.version ?? ""}).`.trim(),
      });
      if (mode === "create" && out.formKey) {
        router.push(`/portal/director/consent-forms/${out.formKey}/edit`);
        router.refresh();
      } else {
        // clear the pending upload so the carried PDF is used on the next save
        setPdfBase64(null);
        setPdfFileName(null);
        router.refresh();
      }
    } catch {
      setNotice({ kind: "err", text: "Something went wrong saving the form. Try again." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Sticky action bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap sticky top-0 z-20 bg-cream/90 backdrop-blur py-1">
        <div className="text-xs text-ink/50">
          {mode === "edit" ? (
            <>
              v{initial.version} · {initial.status}
              {initial.hasDraft && <span className="ml-1">· has draft</span>}
            </>
          ) : (
            "New consent form"
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => save(false)}
            disabled={submitting || needsPdf}
            className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm font-semibold text-ink/70 hover:bg-white disabled:opacity-40 transition-colors"
          >
            Save draft
          </button>
          <button
            type="button"
            onClick={() => save(true)}
            disabled={submitting || needsPdf}
            className="rounded-lg px-3.5 py-1.5 text-sm font-semibold text-white disabled:opacity-40 transition-opacity"
            style={{ background: "var(--pt-accent)" }}
          >
            Publish
          </button>
        </div>
      </div>

      {notice && (
        <div
          className="rounded-sm px-3 py-2 text-sm"
          style={
            notice.kind === "ok"
              ? { background: "var(--pt-accent-soft)", color: "var(--pt-accent-fg)" }
              : { background: "rgba(220,38,38,.08)", color: "#b91c1c" }
          }
        >
          {notice.text}
        </div>
      )}

      {/* ---- Header ---- */}
      <section className="rounded-sm bg-white border border-ink/10 overflow-hidden">
        <div className="h-2" style={{ background: "var(--pt-accent)" }} />
        <div className="p-5 flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="label text-[10.5px] text-ink/45">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Form title"
              className="text-lg font-bold bg-ink/[.03] border-b-2 border-ink/20 focus:border-[color:var(--pt-accent)] outline-none px-2 py-1.5 rounded-t"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="label text-[10.5px] text-ink/45">Document ID</span>
              <input
                value={documentId}
                onChange={(e) => setDocumentId(e.target.value)}
                placeholder="e.g. CL-CONSENT-01"
                className="text-sm font-mono bg-ink/[.03] border-b border-ink/20 focus:border-[color:var(--pt-accent)] outline-none px-2 py-1.5 rounded-t"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="label text-[10.5px] text-ink/45">Audience</span>
              {mode === "create" ? (
                <select
                  value={audience}
                  onChange={(e) => changeAudience(e.target.value as FormAudience)}
                  className="text-sm bg-ink/[.03] border-b border-ink/20 focus:border-[color:var(--pt-accent)] outline-none px-2 py-1.5 rounded-t"
                >
                  {AUDIENCES.map((a) => (
                    <option key={a} value={a}>
                      {AUDIENCE_LABELS[a]}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="text-sm px-2 py-1.5 text-ink/70">
                  {AUDIENCE_LABELS[audience]}
                  <span className="text-ink/40"> (fixed)</span>
                </div>
              )}
            </label>
          </div>

          <label className="flex items-center justify-between gap-3 pt-1">
            <span className="flex flex-col">
              <span className="text-sm font-semibold">Elevated</span>
              <span className="text-xs text-ink/50">Marks this form as carrying an elevated consent.</span>
            </span>
            <Switch checked={elevated} onChange={setElevated} />
          </label>
        </div>
      </section>

      {/* ---- PDF ---- */}
      <section className="flex flex-col gap-3">
        <div className="label text-[10.5px] text-ink/40">Document (PDF)</div>
        {mode === "edit" && initial.pdfUrl && !pdfBase64 && <FormViewer src={initial.pdfUrl} />}
        <div className="rounded-sm border border-dashed border-ink/25 bg-white/60 p-4 flex flex-col gap-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">
              {mode === "create" ? "Upload PDF" : "Replace PDF"}
              {needsPdf && <span className="text-red-500"> *</span>}
            </span>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => onPickPdf(e.target.files?.[0])}
              className="text-sm text-ink/70 file:mr-3 file:rounded-md file:border file:border-ink/15 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-ink/70 hover:file:bg-cream"
            />
          </label>
          {pdfFileName && (
            <p className="text-xs text-ink/60">
              Selected: <span className="font-mono">{pdfFileName}</span> — will replace the current document on save.
            </p>
          )}
          {mode === "edit" && !pdfFileName && (
            <p className="text-xs text-ink/45">Leave empty to keep the current document.</p>
          )}
          {pdfError && <p className="text-xs text-red-600">{pdfError}</p>}
        </div>
      </section>

      {/* ---- Checkbox items ---- */}
      <section className="flex flex-col gap-3">
        <div className="label text-[10.5px] text-ink/40">Checkbox items ({items.length})</div>
        {items.map((it, i) => (
          <div key={it.itemKey} className="rounded-sm bg-white border border-ink/10 p-4 flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <textarea
                value={it.text}
                onChange={(e) => updateItem(i, { text: e.target.value })}
                placeholder="Consent clause text"
                rows={2}
                className="flex-1 text-sm bg-ink/[.03] border-b-2 border-ink/15 focus:border-[color:var(--pt-accent)] outline-none px-2 py-2 rounded-t resize-y"
              />
              <span className="flex flex-col items-center gap-1 text-ink/30 pt-1">
                <button type="button" onClick={() => moveItem(i, -1)} disabled={i === 0} aria-label="Move up" className="disabled:opacity-25 hover:text-ink">▲</button>
                <button type="button" onClick={() => moveItem(i, 1)} disabled={i === items.length - 1} aria-label="Move down" className="disabled:opacity-25 hover:text-ink">▼</button>
              </span>
            </div>
            <div className="flex items-center gap-4 flex-wrap pt-2 border-t border-ink/[.07]">
              <label className="flex items-center gap-2 text-sm text-ink/70">
                Required <Switch checked={it.required} onChange={(v) => updateItem(i, { required: v })} />
              </label>
              <label className="flex items-center gap-2 text-sm text-ink/70">
                Elevated <Switch checked={it.elevated} onChange={(v) => updateItem(i, { elevated: v })} />
              </label>
              <label className="flex items-center gap-2 text-sm text-ink/70">
                Grants
                <select
                  value={it.grantMapping ?? "none"}
                  onChange={(e) => updateItem(i, { grantMapping: e.target.value === "none" ? null : e.target.value })}
                  className="text-sm border border-ink/15 rounded-md bg-white px-2 py-1 outline-none focus:border-[color:var(--pt-accent)]"
                >
                  <option value="none">None</option>
                  {GRANT_MAPPINGS.map((g) => (
                    <option key={g} value={g}>
                      {GRANT_LABELS[g]}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => removeItem(i)}
                className="ml-auto text-sm text-ink/50 hover:text-red-600 transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={addItem}
          className="self-start rounded-lg border border-dashed border-ink/25 px-3.5 py-2 text-sm font-semibold text-ink/60 hover:border-ink/40 hover:text-ink transition-colors bg-white/60"
        >
          + Add checkbox item
        </button>
      </section>

      {/* ---- Detail fields ---- */}
      <section className="flex flex-col gap-3">
        <div className="label text-[10.5px] text-ink/40">Detail fields ({fields.length})</div>
        {fields.map((f, i) => (
          <div
            key={`${f.fieldType}-${i}`}
            className="rounded-sm bg-white border border-ink/10 p-4 flex flex-col gap-3"
          >
            <div className="flex items-start gap-3 flex-wrap">
              <label className="flex flex-col gap-1 flex-1 min-w-[12rem]">
                <span className="label text-[10.5px] text-ink/45">Label</span>
                <input
                  value={f.label}
                  onChange={(e) => updateField(i, { label: e.target.value })}
                  placeholder="Field label"
                  className="text-sm bg-ink/[.03] border-b border-ink/15 focus:border-[color:var(--pt-accent)] outline-none px-2 py-1.5 rounded-t"
                />
              </label>
              <label className="flex flex-col gap-1 w-40">
                <span className="label text-[10.5px] text-ink/45">Key</span>
                <input
                  value={f.fieldType}
                  onChange={(e) => updateField(i, { fieldType: e.target.value })}
                  disabled={f.fixed}
                  placeholder="field_key"
                  className="text-sm font-mono bg-ink/[.03] border-b border-ink/15 focus:border-[color:var(--pt-accent)] outline-none px-2 py-1.5 rounded-t disabled:opacity-60"
                />
              </label>
              <label className="flex flex-col gap-1 w-36">
                <span className="label text-[10.5px] text-ink/45">Type</span>
                <select
                  value={f.inputType}
                  onChange={(e) => updateField(i, { inputType: e.target.value as EditableFieldInputType })}
                  disabled={f.fixed}
                  className="text-sm bg-ink/[.03] border-b border-ink/15 focus:border-[color:var(--pt-accent)] outline-none px-2 py-1.5 rounded-t disabled:opacity-60"
                >
                  {INPUT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {INPUT_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex items-center gap-3 flex-wrap pt-2 border-t border-ink/[.07]">
              <label className={`flex items-center gap-2 text-sm ${f.fixed ? "text-ink/40" : "text-ink/70"}`}>
                Required <Switch checked={f.required} disabled={f.fixed} onChange={(v) => updateField(i, { required: v })} />
              </label>
              {f.fixed ? (
                <span className="text-[11px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 bg-ink/5 text-ink/50">
                  Locked · required default
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => removeField(i)}
                  className="ml-auto text-sm text-ink/50 hover:text-red-600 transition-colors"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={addField}
          className="self-start rounded-lg border border-dashed border-ink/25 px-3.5 py-2 text-sm font-semibold text-ink/60 hover:border-ink/40 hover:text-ink transition-colors bg-white/60"
        >
          + Add field
        </button>
      </section>
    </div>
  );
}

// ---- friendly errors ------------------------------------------------------

function friendlyError(status: number): string {
  if (status === 400) return "The form has a problem the server rejected — check the items and fields, then try again.";
  if (status === 401 || status === 403) return "You don’t have permission to edit consent forms for this chapter.";
  if (status === 404) return "That consent form no longer exists.";
  return "The server couldn’t save the form. Try again in a moment.";
}

// ---- switch (mirrors ApplicationFormEditor) -------------------------------

function Switch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-40 ${checked ? "" : "bg-ink/20"}`}
      style={checked ? { background: "var(--pt-accent)" } : undefined}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"}`} />
    </button>
  );
}
