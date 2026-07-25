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

// ---- type icons (Google-Forms-style menu) ---------------------------------

const TYPE_ICON: Record<QuestionType, React.ReactNode> = {
  short_text: <><line x1="2" y1="6" x2="13" y2="6" /><line x1="2" y1="10" x2="8" y2="10" /></>,
  long_text: <><line x1="2" y1="5" x2="14" y2="5" /><line x1="2" y1="8" x2="14" y2="8" /><line x1="2" y1="11" x2="10" y2="11" /></>,
  email: <><rect x="2" y="4" width="12" height="8" rx="1" /><path d="M3 5.5l5 3.5 5-3.5" /></>,
  phone: <><rect x="4.5" y="2" width="7" height="12" rx="1.5" /><line x1="7" y1="12" x2="9" y2="12" /></>,
  date: <><rect x="2" y="3" width="12" height="11" rx="1.5" /><line x1="2" y1="6.5" x2="14" y2="6.5" /><line x1="5" y1="1.5" x2="5" y2="4" /><line x1="11" y1="1.5" x2="11" y2="4" /></>,
  dropdown: <><circle cx="8" cy="8" r="6" /><path d="M5.5 7l2.5 2.5L10.5 7" /></>,
  multiple_choice: <><circle cx="8" cy="8" r="6" /><circle cx="8" cy="8" r="2.4" fill="currentColor" stroke="none" /></>,
  checkboxes: <><rect x="2" y="2" width="12" height="12" rx="2.5" /><path d="M5 8l2 2 4-4.2" /></>,
  consent: <><path d="M8 2l5 2v3.5c0 3-2 5.2-5 6.3-3-1.1-5-3.3-5-6.3V4l5-2z" /><path d="M5.8 8l1.6 1.6L10.6 6.2" /></>,
};

function TypeIcon({ type }: { type: QuestionType }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {TYPE_ICON[type]}
    </svg>
  );
}

// Type menu order, with dividers like Google Forms.
const TYPE_GROUPS: QuestionType[][] = [
  ["short_text", "long_text"],
  ["multiple_choice", "checkboxes", "dropdown"],
  ["email", "phone"],
  ["date", "consent"],
];

// ---------------------------------------------------------------------------

export default function ApplicationFormEditor() {
  const [form, setForm] = useState<ApplicationForm>(() => defaultForm());
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

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
    updateSection(sectionId, (s) => ({ ...s, questions: s.questions.map((q) => (q.id === qId ? { ...q, ...patch } : q)) }));
  }
  function addQuestion(sectionId: string, afterId?: string) {
    const id = newId();
    updateSection(sectionId, (s) => {
      const q: FormQuestion = { id, key: "", label: "", type: "short_text", required: false };
      if (!afterId) return { ...s, questions: [...s.questions, q] };
      const i = s.questions.findIndex((x) => x.id === afterId);
      const next = [...s.questions];
      next.splice(i + 1, 0, q);
      return { ...s, questions: next };
    });
    setActiveId(id);
  }
  function duplicateQuestion(sectionId: string, qId: string) {
    const id = newId();
    updateSection(sectionId, (s) => {
      const i = s.questions.findIndex((x) => x.id === qId);
      if (i < 0) return s;
      const src = s.questions[i];
      const copy: FormQuestion = { ...src, id, key: "", fixed: false, label: `${src.label} (copy)`, options: src.options ? [...src.options] : undefined };
      const next = [...s.questions];
      next.splice(i + 1, 0, copy);
      return { ...s, questions: next };
    });
    setActiveId(id);
  }
  function removeQuestion(sectionId: string, qId: string) {
    updateSection(sectionId, (s) => ({ ...s, questions: s.questions.filter((q) => q.id !== qId) }));
    if (activeId === qId) setActiveId(null);
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
      sections: form.sections.map((s) => ({ ...s, questions: s.questions.map((q) => ({ ...q, key: q.key || slugKey(q.label) })) })),
      updatedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stamped));
      setForm(stamped);
      setSavedAt(stamped.updatedAt);
      setDirty(false);
    } catch { /* storage unavailable */ }
  }
  function resetToDefault() {
    setForm(defaultForm());
    setDirty(true);
    setActiveId(null);
  }

  if (!loaded) return <div className="text-sm text-ink/40">Loading form…</div>;

  return (
    <div className="flex flex-col gap-5">
      {/* Sticky action bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap sticky top-0 z-20 bg-cream/90 backdrop-blur py-1">
        <div className="text-xs text-ink/50">
          {totalQuestions} questions
          {savedAt ? ` · saved ${new Date(savedAt).toLocaleString()}` : " · not saved yet"}
          {dirty && <span className="ml-1 font-semibold" style={{ color: "var(--pt-accent)" }}>· unsaved changes</span>}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={resetToDefault} className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm font-semibold text-ink/70 hover:bg-white transition-colors">Reset to current</button>
          <button type="button" onClick={save} disabled={!dirty} className="rounded-lg px-3.5 py-1.5 text-sm font-semibold text-white disabled:opacity-40 transition-opacity" style={{ background: "var(--pt-accent)" }}>Save</button>
        </div>
      </div>

      {/* Canvas — click empty space to deselect */}
      <div className="rounded-sm bg-black/[.025] p-4 sm:p-6 flex flex-col gap-4" onClick={() => setActiveId(null)}>
        {/* Form header card with top accent bar */}
        <div className="rounded-sm bg-white border border-ink/10 overflow-hidden">
          <div className="h-2" style={{ background: "var(--pt-accent)" }} />
          <div className="p-5">
            <h2 className="text-xl font-bold">CurioLab application</h2>
            <p className="text-sm text-ink/60 mt-1">
              The questions applicants answer. Click any question to edit it; it looks like the live form until you do.
            </p>
            <div className="mt-3 inline-flex items-start gap-2 rounded-sm px-3 py-2 text-[12px]" style={{ background: "var(--pt-accent-soft)", color: "var(--pt-accent-fg)" }}>
              <span aria-hidden className="mt-px">ⓘ</span>
              <span>Saved to this browser for now — edits don&apos;t yet drive the live apply funnel (backend endpoint pending).</span>
            </div>
          </div>
        </div>

        {form.sections.map((s) => (
          <div key={s.id} className="flex flex-col gap-4">
            {/* Section header */}
            <div className="px-1">
              <div className="label text-[10.5px]">{s.id === "parent" ? "Section 1" : "Section 2"}</div>
              <h3 className="text-base font-bold mt-0.5">{s.title}</h3>
              <p className="text-[13px] text-ink/55">{s.description}</p>
            </div>

            {s.questions.map((q, i) => (
              <QuestionCard
                key={q.id}
                q={q}
                active={activeId === q.id}
                first={i === 0}
                last={i === s.questions.length - 1}
                onActivate={() => setActiveId(q.id)}
                onUpdate={(patch) => updateQuestion(s.id, q.id, patch)}
                onRemove={() => removeQuestion(s.id, q.id)}
                onDuplicate={() => duplicateQuestion(s.id, q.id)}
                onMove={(dir) => moveQuestion(s.id, q.id, dir)}
                onAddAfter={() => addQuestion(s.id, q.id)}
              />
            ))}

            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); addQuestion(s.id); }}
              className="self-start rounded-lg border border-dashed border-ink/25 px-3.5 py-2 text-sm font-semibold text-ink/60 hover:border-ink/40 hover:text-ink transition-colors bg-white/60"
            >
              + Add question
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- question card --------------------------------------------------------

function QuestionCard({
  q, active, first, last, onActivate, onUpdate, onRemove, onDuplicate, onMove, onAddAfter,
}: {
  q: FormQuestion;
  active: boolean;
  first: boolean;
  last: boolean;
  onActivate: () => void;
  onUpdate: (patch: Partial<FormQuestion>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onMove: (dir: -1 | 1) => void;
  onAddAfter: () => void;
}) {
  const [typeMenu, setTypeMenu] = useState(false);
  const isChoice = CHOICE_TYPES.includes(q.type);

  return (
    <div className="relative">
      <div
        onClick={(e) => { e.stopPropagation(); if (!active) onActivate(); }}
        className={`rounded-sm bg-white border transition-shadow cursor-pointer ${active ? "border-ink/10 shadow-lg" : "border-ink/10 hover:shadow-md"}`}
        style={active ? { boxShadow: "inset 5px 0 0 0 var(--pt-accent), 0 10px 30px -12px rgba(0,0,0,.25)" } : undefined}
      >
        {/* drag dots (active only) */}
        {active && (
          <div className="flex justify-center pt-1.5 text-ink/25 select-none" aria-hidden>⠿</div>
        )}

        <div className="p-4 sm:p-5 pt-2">
          {active ? (
            // ---------- EDIT MODE ----------
            <div className="flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start gap-3 flex-col sm:flex-row">
                <input
                  value={q.label}
                  onChange={(e) => onUpdate({ label: e.target.value })}
                  placeholder="Question"
                  autoFocus
                  className="flex-1 min-w-0 w-full text-[15px] bg-ink/[.03] border-b-2 border-ink/20 focus:border-[color:var(--pt-accent)] outline-none px-2 py-2 rounded-t"
                />
                {/* type picker */}
                <div className="relative shrink-0">
                  <button
                    type="button"
                    disabled={q.fixed}
                    onClick={() => setTypeMenu((v) => !v)}
                    className="inline-flex items-center gap-2 rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink/70 hover:bg-cream disabled:opacity-50 min-w-[11rem] justify-between"
                  >
                    <span className="inline-flex items-center gap-2"><TypeIcon type={q.type} />{QUESTION_TYPE_LABELS[q.type]}</span>
                    <span className="text-ink/40">▾</span>
                  </button>
                  {typeMenu && !q.fixed && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setTypeMenu(false)} />
                      <div className="absolute right-0 mt-1 z-50 w-60 rounded-sm border border-ink/10 bg-white shadow-xl py-1">
                        {TYPE_GROUPS.map((group, gi) => (
                          <div key={gi} className={gi > 0 ? "border-t border-ink/[.06] mt-1 pt-1" : ""}>
                            {group.map((t) => (
                              <button
                                key={t}
                                type="button"
                                onClick={() => {
                                  const patch: Partial<FormQuestion> = { type: t };
                                  if (CHOICE_TYPES.includes(t) && !q.options?.length) patch.options = ["Option 1"];
                                  onUpdate(patch);
                                  setTypeMenu(false);
                                }}
                                className={`w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-cream ${t === q.type ? "bg-cream/70" : ""}`}
                              >
                                <span className="text-ink/60"><TypeIcon type={t} /></span>
                                {QUESTION_TYPE_LABELS[t]}
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <input
                value={q.help ?? ""}
                onChange={(e) => onUpdate({ help: e.target.value })}
                placeholder="Description (optional)"
                className="text-xs text-ink/60 border-b border-transparent focus:border-ink/20 outline-none py-0.5 bg-transparent"
              />

              {isChoice ? <OptionsEditor q={q} onUpdate={onUpdate} /> : <EditFieldPreview q={q} />}

              {q.fixed && (
                <div className="text-[11px] text-ink/45">
                  <span className="font-mono uppercase tracking-wide rounded px-1.5 py-0.5 bg-ink/5 text-ink/50 mr-1.5">System field</span>
                  Required by the platform — you can reword it, but not change its type, requirement, or remove it.
                </div>
              )}

              {/* bottom toolbar */}
              <div className="flex items-center gap-1 pt-3 border-t border-ink/[.07] text-ink/50">
                <button type="button" onClick={onDuplicate} disabled={q.fixed} title="Duplicate" className="p-2 rounded hover:bg-cream disabled:opacity-30" aria-label="Duplicate">⧉</button>
                <button type="button" onClick={onRemove} disabled={q.fixed} title={q.fixed ? "System fields can't be removed" : "Delete"} className="p-2 rounded hover:bg-cream disabled:opacity-30" aria-label="Delete">🗑</button>
                <div className="ml-auto flex items-center gap-3">
                  <span className="flex items-center gap-1 text-ink/30">
                    <button type="button" onClick={() => onMove(-1)} disabled={first} aria-label="Move up" className="disabled:opacity-25 hover:text-ink">▲</button>
                    <button type="button" onClick={() => onMove(1)} disabled={last} aria-label="Move down" className="disabled:opacity-25 hover:text-ink">▼</button>
                  </span>
                  <label className={`flex items-center gap-2 text-sm ${q.fixed ? "text-ink/35" : "text-ink/70"}`}>
                    Required
                    <Switch checked={q.required} disabled={q.fixed} onChange={(v) => onUpdate({ required: v })} />
                  </label>
                </div>
              </div>
            </div>
          ) : (
            // ---------- FINAL LOOK ----------
            <div className="flex flex-col gap-2">
              <div className="text-[15px] font-medium">
                {q.label || <span className="text-ink/30">Untitled question</span>}
                {q.required && <span className="text-red-500 ml-1">*</span>}
              </div>
              {q.help && <p className="text-xs text-ink/50 -mt-1">{q.help}</p>}
              <FinalInput q={q} />
            </div>
          )}
        </div>
      </div>

      {/* Floating add toolbar next to the active card (lg+) */}
      {active && (
        <div className="hidden lg:flex flex-col gap-1 absolute top-2 left-full ml-3" onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={onAddAfter} title="Add question" className="w-10 h-10 rounded-lg border border-ink/10 bg-white shadow-sm grid place-items-center text-ink/60 hover:text-ink hover:shadow transition">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}

function Switch({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
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

// ---- options editor (edit mode, choice types) -----------------------------

function OptionsEditor({ q, onUpdate }: { q: FormQuestion; onUpdate: (patch: Partial<FormQuestion>) => void }) {
  const options = q.options ?? [];
  const marker = q.type === "dropdown" ? null : q.type === "checkboxes" ? "☐" : "○";
  return (
    <div className="flex flex-col gap-2">
      {options.map((o, i) => (
        <div key={i} className="flex items-center gap-2.5">
          <span className="text-ink/35 text-sm w-4 text-center">{marker ?? `${i + 1}.`}</span>
          <input value={o} onChange={(e) => onUpdate({ options: options.map((x, idx) => (idx === i ? e.target.value : x)) })} className="flex-1 text-sm border-b border-ink/15 focus:border-[color:var(--pt-accent)] outline-none py-1 bg-transparent" />
          <button type="button" onClick={() => onUpdate({ options: options.filter((_, idx) => idx !== i) })} disabled={options.length <= 1} className="text-ink/30 hover:text-red-500 disabled:opacity-25 text-sm" aria-label="Remove option">✕</button>
        </div>
      ))}
      <div className="flex items-center gap-2.5">
        <span className="text-ink/25 text-sm w-4 text-center">{marker ?? `${options.length + 1}.`}</span>
        <button type="button" onClick={() => onUpdate({ options: [...options, `Option ${options.length + 1}`] })} className="text-sm text-ink/50 hover:text-ink transition-colors">Add option</button>
      </div>
    </div>
  );
}

// A muted echo of the input under the label in edit mode (non-choice types).
function EditFieldPreview({ q }: { q: FormQuestion }) {
  const placeholder =
    q.type === "long_text" ? "Long answer text"
    : q.type === "date" ? "Month, day, year"
    : q.type === "email" ? "Email"
    : q.type === "phone" ? "Phone number"
    : q.type === "consent" ? "Checkbox the applicant must tick"
    : "Short answer text";
  return <div className="text-sm text-ink/35 border-b border-dashed border-ink/20 pb-1 w-64 max-w-full">{placeholder}</div>;
}

// ---- final (live-looking) input -------------------------------------------

function FinalInput({ q }: { q: FormQuestion }) {
  const line = "border-b border-ink/20 text-sm text-ink/35 pb-1";
  switch (q.type) {
    case "long_text":
      return <div className="rounded-md border border-ink/15 min-h-[3.5rem] px-3 py-2 text-sm text-ink/30">Long answer text</div>;
    case "date":
      return <div className={`${line} w-44`}>Month, day, year</div>;
    case "email":
      return <div className={`${line} w-72 max-w-full`}>name@example.com</div>;
    case "phone":
      return <div className={`${line} w-48`}>(555) 555-5555</div>;
    case "dropdown":
      return <div className="rounded-md border border-ink/15 w-64 max-w-full px-3 py-2 text-sm text-ink/40 flex items-center justify-between"><span>{q.options?.[0] ?? "Choose"}</span><span>▾</span></div>;
    case "multiple_choice":
      return <div className="flex flex-col gap-2 mt-0.5">{(q.options ?? []).map((o, i) => <div key={i} className="text-sm text-ink/60 flex items-center gap-2.5"><span className="w-4 h-4 rounded-full border border-ink/30 inline-block" />{o}</div>)}</div>;
    case "checkboxes":
      return <div className="flex flex-col gap-2 mt-0.5">{(q.options ?? []).map((o, i) => <div key={i} className="text-sm text-ink/60 flex items-center gap-2.5"><span className="w-4 h-4 rounded border border-ink/30 inline-block" />{o}</div>)}</div>;
    case "consent":
      return <div className="text-sm text-ink/60 flex items-center gap-2.5"><span className="w-4 h-4 rounded border border-ink/30 inline-block shrink-0" />{q.label || "I agree"}</div>;
    default:
      return <div className={`${line} w-80 max-w-full`}>Short answer text</div>;
  }
}
