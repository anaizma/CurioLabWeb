'use client'
import { useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

/** Display-only PDF reader. `onHash` reports the sha256 of the fetched bytes (binds the audit). */
export default function FormViewer({ src, onHash }: { src: string; onHash?: (sha256: string) => void }) {
  const [numPages, setNumPages] = useState(0)
  const [page, setPage] = useState(1)

  async function hashBytes() {
    if (!onHash) return
    const buf = await (await fetch(src)).arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', buf)
    onHash([...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join(''))
  }

  return (
    <div className="border border-black/10 rounded-lg bg-white overflow-hidden">
      <Document file={src} onLoadSuccess={(d: { numPages: number }) => { setNumPages(d.numPages); void hashBytes() }} loading={<div className="p-6 text-sm text-muted">Loading form…</div>}>
        <Page pageNumber={page} width={640} renderTextLayer renderAnnotationLayer={false} />
      </Document>
      <div className="flex items-center justify-between px-3 py-2 border-t border-black/10 text-[12px]">
        <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="disabled:opacity-40">← Prev</button>
        <span className="font-mono">{page} / {numPages || '…'}</span>
        <button type="button" disabled={page >= numPages} onClick={() => setPage((p) => p + 1)} className="disabled:opacity-40">Next →</button>
      </div>
    </div>
  )
}
