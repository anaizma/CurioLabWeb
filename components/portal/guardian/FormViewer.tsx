'use client'
import { useEffect } from 'react'

/**
 * Display-only PDF reader: embeds the actual PDF file in the browser's native
 * PDF viewer (its own sandboxed iframe) — the real PDF, native vertical scroll +
 * zoom, no JS re-rendering. `onHash` reports the sha256 of the fetched bytes so
 * the completion audit binds to exactly the document shown.
 */
export default function FormViewer({ src, onHash }: { src: string; onHash?: (sha256: string) => void }) {
  useEffect(() => {
    if (!onHash) return
    let cancelled = false
    void (async () => {
      try {
        const buf = await (await fetch(src)).arrayBuffer()
        const digest = await crypto.subtle.digest('SHA-256', buf)
        if (!cancelled) onHash([...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join(''))
      } catch {
        /* leave the hash unset; submit stays disabled until the bytes load */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [src, onHash])

  return (
    <div className="border border-black/10 rounded-lg overflow-hidden bg-neutral-100">
      <iframe src={`${src}#view=FitH`} title="Consent form (PDF)" className="w-full" style={{ height: '80vh' }} />
      <div className="flex items-center justify-between px-3 py-2 border-t border-black/10 text-[12px]">
        <span className="text-muted">Scroll to read the full form.</span>
        <a href={src} target="_blank" rel="noreferrer" className="font-semibold" style={{ color: 'var(--pt-accent)' }}>
          Open PDF ↗
        </a>
      </div>
    </div>
  )
}
