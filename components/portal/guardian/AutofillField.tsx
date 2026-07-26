'use client'
import { useState } from 'react'
import type { FormFieldSchema } from '@/lib/portal/guardian/consent-forms'

export default function AutofillField({ field, value, suggestion, onChange }: {
  field: FormFieldSchema; value: string; suggestion?: string; onChange: (v: string) => void
}) {
  const [focused, setFocused] = useState(false)
  const showChip = focused && !!suggestion && suggestion !== value && !value
  return (
    <label className="flex flex-col gap-1 relative">
      <span className="text-[12px] font-semibold">{field.label}{field.required && <span className="text-red-500"> *</span>}</span>
      <input type={field.inputType} value={value} required={field.required}
        onFocus={() => setFocused(true)} onBlur={() => setTimeout(() => setFocused(false), 150)}
        onChange={(e) => onChange(e.target.value)}
        className="border border-black/15 rounded-md px-2.5 py-1.5 text-[13px]" />
      {showChip && (
        <button type="button" onMouseDown={(e) => { e.preventDefault(); onChange(suggestion!) }}
          className="absolute top-full mt-1 z-10 rounded-md border border-black/15 bg-white px-2.5 py-1 text-[12px] shadow-sm text-left">
          <span className="text-muted">Use saved:</span> <span className="font-semibold">{suggestion}</span>
        </button>
      )}
    </label>
  )
}
