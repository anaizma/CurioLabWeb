'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { FormListEntry } from '@/lib/portal/guardian/consent-forms'
import FormViewer from '@/components/portal/guardian/FormViewer'
import SignaturePad from '@/components/portal/guardian/SignaturePad'
import AutofillField from '@/components/portal/guardian/AutofillField'
import VerificationStep, { type VerificationResult } from '@/components/portal/guardian/VerificationStep'

export default function FormEditor({ childId, entry, forms, isSample }: { childId: string; entry: FormListEntry; forms: FormListEntry[]; isSample: boolean }) {
  const { schema } = entry
  const router = useRouter()
  const [itemStates, setItemStates] = useState<Record<string, boolean>>(() => Object.fromEntries(schema.items.map((i) => [i.itemKey, false])))
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const [signature, setSignature] = useState('')
  const [pdfSha256, setPdfSha256] = useState('')
  const [verification, setVerification] = useState<VerificationResult | undefined>()
  const [saved, setSaved] = useState<{ fields: Record<string, string>; signature: string | null }>({ fields: {}, signature: null })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void fetch('/api/guardian/forms/saved-fields').then((r) => r.ok ? r.json() : null).then((s) => s && setSaved(s))
    void fetch(`/api/guardian/children/${childId}/forms/${schema.formId}/draft`).then((r) => r.ok ? r.json() : null).then((d) => {
      if (d && d.itemStates) { setItemStates((s) => ({ ...s, ...d.itemStates })); setFieldValues(d.fieldValues ?? {}); if (d.signature) setSignature(d.signature) }
    })
  }, [childId, schema.formId])

  const t = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (isSample) return
    if (t.current) clearTimeout(t.current)
    t.current = setTimeout(() => {
      void fetch(`/api/guardian/children/${childId}/forms/${schema.formId}/draft`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemStates, fieldValues, signature, pdfSha256 }),
      })
    }, 800)
    return () => { if (t.current) clearTimeout(t.current) }
  }, [itemStates, fieldValues, signature, pdfSha256, childId, schema.formId, isSample])

  const missingRequired = useMemo(() =>
    schema.items.some((i) => i.required && !itemStates[i.itemKey]) ||
    schema.fields.some((f) => f.required && !fieldValues[f.fieldType]?.trim()) ||
    !signature, [schema, itemStates, fieldValues, signature])
  const needsVerify = schema.elevated || schema.items.some((i) => i.elevated && itemStates[i.itemKey])
  const canSubmit = !missingRequired && (!needsVerify || !!verification) && !!pdfSha256 && !isSample && !busy

  async function submit() {
    setBusy(true); setError(null)
    const res = await fetch(`/api/guardian/children/${childId}/forms/${schema.formId}/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ itemStates, fieldValues, signature, pdfSha256, verification }),
    })
    setBusy(false)
    if (res.ok) router.push('/portal/parent/consent')
    else setError(`Could not submit (${res.status}). Check required items and try again.`)
  }

  const guardianForms = forms.filter((f) => f.schema.audience === 'guardian')
  return (
    <div className="mx-auto max-w-7xl px-5 py-5 flex flex-col gap-4">
      {/* Form switcher — jump between forms without leaving the page. Wraps onto
          the next row (no horizontal scroll) so every form is visible at once.
          Completed forms show a green check. */}
      <nav className="flex flex-wrap gap-2">
        {guardianForms.map(({ schema: s, status }) => {
          const current = s.formId === schema.formId
          const done = status === 'complete'
          const n = Number(s.formId.replace('form-', ''))
          return (
            <Link
              key={s.formId}
              href={`/portal/parent/consent/${s.formId}`}
              title={s.title}
              aria-current={current ? 'page' : undefined}
              className="shrink-0 flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] max-w-[190px] hover:bg-black/[.02]"
              style={{
                borderColor: current ? 'var(--pt-accent)' : done ? '#cfe6d6' : 'rgba(0,0,0,0.1)',
                background: current ? 'var(--pt-accent-soft)' : done ? '#e7f2ea' : undefined,
                color: current ? 'var(--pt-accent-fg)' : done ? '#2f7a4d' : undefined,
                fontWeight: current || done ? 600 : 400,
              }}
            >
              <span className="shrink-0 font-mono text-[10px] leading-none">{done ? '✓' : n}</span>
              <span className="truncate">{s.title}</span>
            </Link>
          )
        })}
      </nav>
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_360px]">
        <div>
        <h1 className="text-lg font-bold tracking-tight mb-1">{schema.title}</h1>
        <p className="font-mono text-[11px] text-muted mb-3">{schema.documentId} · v{schema.version}{schema.elevated && ' · Elevated'}</p>
        <FormViewer src={schema.pdfPath} onHash={setPdfSha256} />
      </div>
      <div className="flex flex-col gap-4">
        {isSample && <div className="text-[11px] font-mono text-muted border border-dashed border-black/15 rounded-md px-3 py-2">Sample — sign in as a guardian to submit.</div>}
        <section className="flex flex-col gap-2">
          <h2 className="text-[13px] font-semibold">Your choices</h2>
          {schema.items.map((i) => (
            <label key={i.itemKey} className="flex gap-2 text-[12.5px] items-start">
              <input type="checkbox" checked={!!itemStates[i.itemKey]} onChange={(e) => setItemStates((s) => ({ ...s, [i.itemKey]: e.target.checked }))} className="mt-0.5" />
              <span>{i.text}{i.required && <span className="text-red-500"> *</span>}{i.elevated && <span className="font-mono text-[10px] text-muted"> · elevated</span>}</span>
            </label>
          ))}
        </section>
        {schema.fields.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-[13px] font-semibold">Your details</h2>
            {schema.fields.map((f) => (
              <AutofillField key={f.fieldType} field={f} value={fieldValues[f.fieldType] ?? ''} suggestion={saved.fields[f.fieldType]}
                onChange={(v) => setFieldValues((s) => ({ ...s, [f.fieldType]: v }))} />
            ))}
          </section>
        )}
        <section className="flex flex-col gap-2">
          <h2 className="text-[13px] font-semibold">Signature <span className="text-red-500">*</span></h2>
          <SignaturePad value={signature} onChange={setSignature} saved={saved.signature} />
        </section>
        {needsVerify && !verification && <VerificationStep onVerified={setVerification} />}
        {error && <p className="text-[12px] text-red-600">{error}</p>}
        <button type="button" disabled={!canSubmit} onClick={submit}
          className="rounded-md px-3 py-2 text-[13px] font-semibold disabled:opacity-40" style={{ background: 'var(--pt-accent)', color: 'var(--pt-on-accent)' }}>
          {busy ? 'Submitting…' : 'Submit form'}
        </button>
      </div>
      </div>
    </div>
  )
}
