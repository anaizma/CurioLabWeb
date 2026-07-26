'use client'
import Link from 'next/link'
import type { FormListEntry } from '@/lib/portal/guardian/consent-forms'

const CHIP: Record<FormListEntry['status'], { label: string; bg: string; fg: string }> = {
  complete: { label: 'Complete', bg: '#e7f2ea', fg: '#2f7a4d' },
  in_progress: { label: 'In progress', bg: '#fcf1d6', fg: '#8a5b00' },
  not_started: { label: 'Not started', bg: '#eef0f2', fg: '#556' },
}

export default function ConsentClient({ forms }: { forms: FormListEntry[] }) {
  const guardian = forms.filter((f) => f.schema.audience === 'guardian')
  const done = guardian.filter((f) => f.status === 'complete').length
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-muted font-mono">{done}/{guardian.length} guardian forms complete</p>
      <div className="bg-white border border-black/[.08] rounded-lg divide-y divide-black/[.05]">
        {guardian.map(({ schema, status }) => {
          const c = CHIP[status]
          return (
            <Link key={schema.formId} href={`/portal/parent/consent/${schema.formId}`} className="p-3.5 flex items-center justify-between gap-3 hover:bg-black/[.02]">
              <div className="min-w-0">
                <div className="text-[13.5px] font-semibold">{schema.title}</div>
                <div className="font-mono text-[10.5px] text-muted mt-0.5">{schema.documentId} · v{schema.version}{schema.elevated && ' · Elevated'}</div>
              </div>
              <span className="font-mono text-[9.5px] uppercase tracking-wider rounded-full px-2 py-0.5 shrink-0" style={{ background: c.bg, color: c.fg }}>{c.label}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
