'use client'
import { useState } from 'react'

export type VerificationResult = { method: 'signed_form'|'monetary_transaction'|'video_call'|'id_verification'; evidenceArtifactRef: string }

/** STUB elevated-verification hook. Swap this component for a real provider later.
 *  It requires a deliberate confirmation and yields a strong method + evidence ref. */
export default function VerificationStep({ onVerified }: { onVerified: (r: VerificationResult) => void }) {
  const [done, setDone] = useState(false)
  return (
    <div className="rounded-md border border-dashed p-3 text-[12.5px]" style={{ borderColor: 'var(--pt-accent-border)', background: 'var(--pt-accent-soft)' }}>
      <p className="font-semibold" style={{ color: 'var(--pt-accent-fg)' }}>Identity check required (Elevated form)</p>
      <p className="text-muted mt-1">A drawn signature alone is not enough for this permission. Confirm your identity to continue.</p>
      {done ? (
        <p className="mt-2 font-mono text-[11px]" style={{ color: 'var(--pt-accent-fg)' }}>✓ Verified (stub)</p>
      ) : (
        <button type="button" className="mt-2 rounded-md px-2.5 py-1 text-[12px] font-semibold" style={{ background: 'var(--pt-accent)', color: 'var(--pt-on-accent)' }}
          onClick={() => { setDone(true); onVerified({ method: 'signed_form', evidenceArtifactRef: `stub://verify/${Date.now()}` }) }}>
          Confirm identity (stub)
        </button>
      )}
    </div>
  )
}
