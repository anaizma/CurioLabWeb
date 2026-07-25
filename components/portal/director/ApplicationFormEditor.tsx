"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type ApplicationForm,
  type FormQuestion,
  type FormSection,
  type QuestionType,
  QUESTION_TYPE_LABELS,
  CHOICE_TYPES,
  STORAGE_KEY,
  defaultForm,
  slugKey,
} from "@/lib/portal/director/application-form";

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `q_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  }
}

export default function ApplicationFormEditor() {
  const [form, setForm] = useState<ApplicationForm>(() => defaultForm());
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  // Load persisted definition (browser-local for now).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ApplicationForm;
        if (parsed?.sections?.length) {
          setForm(parsed);
          setSavedAt(parsed.updatedAt);
        }
      }
    } catch { /* ignore corrupt storage */ }
    setLoaded(true);
  }, []);

  const totalQuestions = useMemo(
    () => form.sections.reduce((n, s) => n + s.questions.length, 0),
    [form],
  );

  function mutate(next: ApplicationForm) {
    setForm(next);
    setDirty(true);
  }

  function updateSection(sectionId: string, updater: (s: FormSection) => FormSection) {
    mutate({ ...form, sections: form.sections.map((s) => (s.id === sectionId ? updater(s) : s)) });
  }

  function updateQuestion(sectionId: string, qId: string, patch: Partial<FormQuestion>) {
    updateSection(sectionId, (s) => ({
      ...s,
      questions: s.questions.map((q) => (q.id === qId ? { ...q, ...patch } : q)),
    }));
  }

  function addQuestion(sectionId: string) {
    updateSection(sectionId, (s) => ({
      ...s,
      questions: [
        ...s.questions,
        { id: newId(), key: "", label: "", type: "short_text", required: false },
      ],
    }));
  }

  function removeQuestion(sectionId: string, qId: string) {
    updateSection(sectionId, (s) => ({ ...s, questions: s.questions.filter((q) => q.id !== qId) }));
  }

  function moveQuestion(sectionId: string, qId: string, dir: -1 | 1) {
    updateSection(sectionId, (s) => {
      const i = s.questions.findIndex((q) => q.id === qId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.questions.length) return s;
      const next = [...s.questions];
      [next[i], next[j]] = [next[j], next[i]];
      return { ...s, questions: next };
    });
  }

  function save() {
    const stamped: ApplicationForm = {
      ...form,
      // Fill machine keys for any new questions from their label.
      sections: form.sections.map((s) => ({
        ...s,
        questions: s.questions.map((q) => ({ ...q, key: q.key || slugKey(q.label) })),
      })),
      updatedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stamped));
      setForm(stamped);
      setSavedAt(stamped.updatedAt);
      setDirty(false);
    } catch { /* storage may be unavailable */ }
  }

  function resetToDefault() {
    const d = defaultForm();
    setForm(d);
    setDirty(true);
  }

  if (!loaded) {
    return <div className="text-sm text-ink/40">Loading form…</div>;
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Not-yet-connected notice */}
      <div className="rounded-lg border px-4 py-3 text-[13px] flex items-start gap-2.5" style={{ borderColor: "var(--pt-accent-border)", background: "var(--pt-accent-soft)", color: "var(--pt-accent-fg)" }}>
        <span aria-hidden className="mt-0.5">ⓘ</span>
        <p>
          This is the application-form designer. Changes are saved to <strong>this browser</strong> for now — they don&apos;t
          yet drive the live apply funnel. Connecting it end-to-end needs the backend form-definition endpoint
          (spec drafted for the platform team).
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap sticky top-0 z-10 bg-cream/90 backdrop-blur py-1">
        <div className="text-xs text-ink/50">
          {totalQuestions} questions
          {savedAt ? ` · saved ${new Date(savedAt).toLocaleString()}` : " · not saved yet"}
          {dirty && <span className="ml-1 font-semibold" style={{ color: "var(--pt-accent)" }}>· unsaved changes</span>}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setPreview((v) => !v)} className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm font-semibold text-ink/70 hover:bg-white transition-colors">
            {preview ? "Back to editing" : "Preview form"}
          </button>
          <button type="button" onClick={resetToDefault} className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm font-semibold text-ink/70 hover:bg-white transition-colors">
            Reset to current
          </button>
          <button type="button" onClick={save} disabled={!dirty} className="rounded-lg px-3.5 py-1.5 text-sm font-semibold text-white disabled:opacity-40 transition-opacity" style={{ background: "var(--pt-accent)" }}>
            Save
          </button>
        </div>
      </div>

      {preview
        ? form.sections.map((s) => <PreviewSection key={s.id} section={s} />)
        : form.sections.map((s) => (
            <EditSection
              key={s.id}
              section={s}
              onAdd={() => addQuestion(s.id)}
              onUpdate={(qId, patch) => updateQuestion(s.id, qId, patch)}
              onRemove={(qId) => removeQuestion(s.id, qId)}
              onMove={(qId, dir) => moveQuestion(s.id, qId, dir)}
            />
          ))}
    </div>
  );
}

// ---- edit mode ------------------------------------------------------------

function EditSection({
  section,
  onAdd,
  onUpdate,
  onRemove,
  onMove,
}: {
  section: FormSection;
  onAdd: () => void;
  onUpdate: (qId: string, patch: Partial<FormQuestion>) => void;
  onRemove: (qId: string) => void;
  onMove: (qId: string, dir: -1 | 1) => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-bold">{section.title}</h2>
        <p className="text-[13px] text-ink/55 mt-0.5">{section.description}</p>
      </div>
      {section.questions.map((q, i) => (
        <QuestionCard
          key={q.id}
          q={q}
          first={i === 0}
          last={i === section.questions.length - 1}
          onUpdate={(patch) => onUpdate(q.id, patch)}
          onRemove={() => onRemove(q.id)}
          onMove={(dir) => onMove(q.id, dir)}
        />
      ))}
      <button type="button" onClick={onAdd} className="self-start rounded-lg border border-dashed border-ink/25 px-3.5 py-2 text-sm font-semibold text-ink/60 hover:border-ink/40 hover:text-ink transition-colors">
        + Add question
      </button>
    </section>
  );
}

function QuestionCard({
  q,
  first,
  last,
  onUpdate,
  onRemove,
  onMove,
}: {
  q: FormQuestion;
  first: boolean;
  last: boolean;
  onUpdate: (patch: Partial<FormQuestion>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const isChoice = CHOICE_TYPES.includes(q.type);
  return (
    <div className="rounded-xl border border-ink/10 bg-white p-4 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="flex flex-col gap-0.5 pt-1 text-ink/30">
          <button type="button" onClick={() => onMove(-1)} disabled={first} aria-label="Move up" className="disabled:opacity-25 hover:text-ink transition-colors leading-none">▲</button>
          <button type="button" onClick={() => onMove(1)} disabled={last} aria-label="Move down" className="disabled:opacity-25 hover:text-ink transition-colors leading-none">▼</button>
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={q.label}
              onChange={(e) => onUpdate({ label: e.target.value })}
              placeholder="Question text"
              className="flex-1 min-w-[12rem] text-sm font-medium border-b border-ink/15 focus:border-ink/50 outline-none py-1 bg-transparent"
            />
            {q.fixed && (
              <span className="text-[10px] font-mono uppercase tracking-wide rounded px-1.5 py-0.5 bg-ink/5 text-ink/50 shrink-0">System field</span>
            )}
          </div>

          <input
            value={q.help ?? ""}
            onChange={(e) => onUpdate({ help: e.target.value })}
            placeholder="Helper text (optional)"
            className="text-xs text-ink/60 border-b border-transparent focus:border-ink/20 outline-none py-0.5 bg-transparent"
          />

          {isChoice && <OptionsEditor q={q} onUpdate={onUpdate} />}

          <div className="flex items-center gap-4 flex-wrap pt-0.5">
            <label className="text-xs text-ink/50 flex items-center gap-1.5">
              Type
              <select
                value={q.type}
                disabled={q.fixed}
                onChange={(e) => {
                  const type = e.target.value as QuestionType;
                  const patch: Partial<FormQuestion> = { type };
                  if (CHOICE_TYPES.includes(type) && !q.options?.length) patch.options = ["Option 1"];
                  onUpdate(patch);
                }}
                className="rounded-md border border-ink/15 bg-white px-2 py-1 text-xs font-semibold text-ink/70 disabled:opacity-50"
              >
                {(Object.keys(QUESTION_TYPE_LABELS) as QuestionType[]).map((t) => (
                  <option key={t} value={t}>{QUESTION_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </label>

            <label className={`text-xs flex items-center gap-1.5 ${q.fixed ? "text-ink/35" : "text-ink/60"}`}>
              <input type="checkbox" checked={q.required} disabled={q.fixed} onChange={(e) => onUpdate({ required: e.target.checked })} />
              Required
            </label>

            <button
              type="button"
              onClick={onRemove}
              disabled={q.fixed}
              title={q.fixed ? "System fields can't be removed" : "Remove question"}
              className="ml-auto text-xs font-semibold text-red-500/80 hover:text-red-600 disabled:opacity-30 disabled:hover:text-red-500/80 transition-colors"
            >
              Remove
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function OptionsEditor({ q, onUpdate }: { q: FormQuestion; onUpdate: (patch: Partial<FormQuestion>) => void }) {
  const options = q.options ?? [];
  function set(i: number, value: string) {
    onUpdate({ options: options.map((o, idx) => (idx === i ? value : o)) });
  }
  function add() {
    onUpdate({ options: [...options, `Option ${options.length + 1}`] });
  }
  function remove(i: number) {
    onUpdate({ options: options.filter((_, idx) => idx !== i) });
  }
  return (
    <div className="flex flex-col gap-1.5 pl-1">
      {options.map((o, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-ink/30 text-xs">{q.type === "dropdown" ? `${i + 1}.` : q.type === "checkboxes" ? "☐" : "○"}</span>
          <input value={o} onChange={(e) => set(i, e.target.value)} className="flex-1 text-xs border-b border-ink/15 focus:border-ink/40 outline-none py-0.5 bg-transparent" />
          <button type="button" onClick={() => remove(i)} disabled={options.length <= 1} className="text-ink/30 hover:text-red-500 disabled:opacity-25 text-xs" aria-label="Remove option">✕</button>
        </div>
      ))}
      <button type="button" onClick={add} className="self-start text-xs font-semibold text-ink/50 hover:text-ink transition-colors">+ Add option</button>
    </div>
  );
}

// ---- preview mode ---------------------------------------------------------

function PreviewSection({ section }: { section: FormSection }) {
  return (
    <section className="rounded-xl border border-ink/10 bg-white p-5 flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-bold">{section.title}</h2>
        <p className="text-[13px] text-ink/55 mt-0.5">{section.description}</p>
      </div>
      {section.questions.map((q) => (
        <div key={q.id} className="flex flex-col gap-1">
          <label className="text-sm font-medium">
            {q.label || <span className="text-ink/30">Untitled question</span>}
            {q.required && <span className="text-red-500 ml-1">*</span>}
          </label>
          {q.help && <p className="text-xs text-ink/50">{q.help}</p>}
          <PreviewInput q={q} />
        </div>
      ))}
    </section>
  );
}

function PreviewInput({ q }: { q: FormQuestion }) {
  const base = "rounded-lg border border-ink/15 bg-ink/[.02] text-sm text-ink/50 px-3 py-2 pointer-events-none";
  switch (q.type) {
    case "long_text":
      return <div className={`${base} min-h-[3.5rem]`}>Long answer…</div>;
    case "date":
      return <div className={`${base} w-44`}>mm / dd / yyyy</div>;
    case "email":
      return <div className={`${base} w-72 max-w-full`}>name@example.com</div>;
    case "phone":
      return <div className={`${base} w-48`}>(555) 555-5555</div>;
    case "dropdown":
      return <div className={`${base} w-64 max-w-full flex items-center justify-between`}><span>{q.options?.[0] ?? "Choose…"}</span><span>▾</span></div>;
    case "multiple_choice":
      return (
        <div className="flex flex-col gap-1.5">
          {(q.options ?? []).map((o, i) => <div key={i} className="text-sm text-ink/55 flex items-center gap-2"><span>○</span>{o}</div>)}
        </div>
      );
    case "checkboxes":
      return (
        <div className="flex flex-col gap-1.5">
          {(q.options ?? []).map((o, i) => <div key={i} className="text-sm text-ink/55 flex items-center gap-2"><span>☐</span>{o}</div>)}
        </div>
      );
    case "consent":
      return <div className="text-sm text-ink/55 flex items-center gap-2"><span>☐</span>{q.label || "I agree"}</div>;
    default:
      return <div className={`${base} w-80 max-w-full`}>Short answer…</div>;
  }
}
