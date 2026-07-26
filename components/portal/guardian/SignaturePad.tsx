'use client'
import { useEffect, useRef, useState } from 'react'

/** Draw a signature (mouse/finger). value/onChange is a PNG data URL. `saved` offers one-tap reuse. */
export default function SignaturePad({ value, onChange, saved }: { value: string; onChange: (dataUrl: string) => void; saved?: string | null }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [dirty, setDirty] = useState(Boolean(value))

  useEffect(() => {
    const c = ref.current!; const ctx = c.getContext('2d')!
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
    ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.lineCap = 'round'
    if (value) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height); img.src = value }
  }, [value])

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const start = (e: React.PointerEvent) => { drawing.current = true; const ctx = ref.current!.getContext('2d')!; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y) }
  const move = (e: React.PointerEvent) => { if (!drawing.current) return; const ctx = ref.current!.getContext('2d')!; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke() }
  const end = () => { if (!drawing.current) return; drawing.current = false; setDirty(true); onChange(ref.current!.toDataURL('image/png')) }
  const clear = () => { const c = ref.current!; const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); setDirty(false); onChange('') }

  return (
    <div className="flex flex-col gap-2">
      <canvas ref={ref} width={440} height={140}
        onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end}
        className="border border-black/15 rounded-md touch-none bg-white w-full" style={{ maxWidth: 440 }} />
      <div className="flex items-center gap-3 text-[12px]">
        <button type="button" onClick={clear} className="text-muted hover:text-ink">Clear</button>
        {saved && !dirty && (
          <button type="button" onClick={() => { onChange(saved); setDirty(true) }} className="font-semibold" style={{ color: 'var(--pt-accent)' }}>
            Reuse saved signature
          </button>
        )}
      </div>
    </div>
  )
}
