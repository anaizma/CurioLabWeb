import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import PDFDocument from 'pdfkit'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const srcDir = join(root, 'content', 'consent-forms')
const outDir = join(root, 'public', 'consent-forms')
const appConsentDir = join(root, 'packages', 'app', 'src', 'consent-forms')
const hashOut = join(appConsentDir, 'pdf-hashes.json')
const parsedOut = join(appConsentDir, 'parsed-items.json')
mkdirSync(outDir, { recursive: true })

// "Form-02-Public-Publication-Consent.md" -> "form-02"
const formId = (file) => 'form-' + file.match(/^Form-(\d\d)-/)[1]

// Same clause regex as packages/app/src/consent-forms/parse.ts (Task 4). Trivial
// and identical by construction; parse.ts stays the unit-tested canonical.
function parseItems(id, md) {
  let n = 0; const items = []
  for (const line of md.split('\n')) {
    const m = line.match(/^\s*[-*]\s+\[\s?\]\s+(.*\S)\s*$/)
    if (m) { n += 1; items.push({ itemKey: `${id}:item-${n}`, text: m[1] }) }
  }
  return items
}

const MARGIN = 56
const BODY = 10.5

// --- Markdown -> block list (headings, paragraphs, lists, checkboxes, quotes,
//     horizontal rules, and pipe tables). Good enough for these legal forms. ---
function parseBlocks(md) {
  const lines = md.split('\n')
  const isTable = (l) => /^\s*\|.*\|\s*$/.test(l)
  const isSep = (l) => /^\s*\|[\s:|-]+\|\s*$/.test(l)
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const raw = lines[i]
    const t = raw.trim()
    if (t === '') { i += 1; continue }
    if (t === '---' || t === '***' || t === '___') { blocks.push({ type: 'hr' }); i += 1; continue }
    let m
    if ((m = t.match(/^(#{1,6})\s+(.*)$/))) { blocks.push({ type: 'heading', level: m[1].length, text: m[2] }); i += 1; continue }
    if (t.startsWith('>')) {
      const buf = []
      while (i < lines.length && lines[i].trim().startsWith('>')) { buf.push(lines[i].trim().replace(/^>\s?/, '')); i += 1 }
      blocks.push({ type: 'quote', text: buf.join(' ') }); continue
    }
    if (isTable(raw)) {
      const rows = []
      while (i < lines.length && isTable(lines[i])) {
        if (!isSep(lines[i])) rows.push(lines[i].trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()))
        i += 1
      }
      blocks.push({ type: 'table', rows }); continue
    }
    if ((m = t.match(/^[-*]\s+\[( |x|X)?\]\s+(.*)$/))) { blocks.push({ type: 'checkbox', text: m[2] }); i += 1; continue }
    if ((m = t.match(/^[-*]\s+(.*)$/))) { blocks.push({ type: 'bullet', text: m[1] }); i += 1; continue }
    const buf = [t]; i += 1
    while (i < lines.length) {
      const nt = lines[i].trim()
      if (nt === '' || nt === '---' || /^#{1,6}\s/.test(nt) || nt.startsWith('>') || isTable(lines[i]) || /^[-*]\s/.test(nt)) break
      buf.push(nt); i += 1
    }
    blocks.push({ type: 'para', text: buf.join(' ') })
  }
  return blocks
}

// Render one line of text with **bold** runs, wrapping within [x, x+width].
function writeInline(doc, text, x, y, width, { size = BODY, color = '#111' } = {}) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter((s) => s !== '')
  if (parts.length === 0) parts.push('')
  parts.forEach((p, idx) => {
    const bold = /^\*\*[\s\S]+\*\*$/.test(p)
    const str = bold ? p.slice(2, -2) : p
    const cont = idx < parts.length - 1
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color)
    if (idx === 0) doc.text(str, x, y, { width, continued: cont })
    else doc.text(str, { continued: cont })
  })
  doc.font('Helvetica').fillColor('#111')
}

function renderMarkdownToPdf(md, outPath) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: MARGIN, info: { Producer: 'CurioLab', Creator: 'CurioLab', CreationDate: new Date(0) } })
    const chunks = []
    doc.on('data', (c) => chunks.push(c))
    doc.on('end', () => { writeFileSync(outPath, Buffer.concat(chunks)); resolve() })

    const contentW = doc.page.width - MARGIN * 2
    const bottom = () => doc.page.height - doc.page.margins.bottom
    const ensure = (h) => { if (doc.y + h > bottom()) doc.addPage() }

    for (const b of parseBlocks(md)) {
      if (b.type === 'hr') {
        doc.moveDown(0.4)
        doc.lineWidth(0.5).strokeColor('#ddd').moveTo(MARGIN, doc.y).lineTo(MARGIN + contentW, doc.y).stroke()
        doc.moveDown(0.6)
      } else if (b.type === 'heading') {
        const size = b.level === 1 ? 19 : b.level === 2 ? 14.5 : 12
        doc.moveDown(b.level === 1 ? 0.2 : 0.5)
        ensure(size + 8)
        doc.font('Helvetica-Bold').fontSize(size).fillColor('#111').text(b.text.replace(/\*\*/g, ''), MARGIN, doc.y, { width: contentW })
        doc.moveDown(0.3)
      } else if (b.type === 'quote') {
        doc.font('Helvetica').fontSize(BODY)
        const h = doc.heightOfString(b.text.replace(/\*\*/g, ''), { width: contentW - 24 }) + 12
        ensure(h)
        const y = doc.y
        doc.rect(MARGIN, y, contentW, h).fill('#f5f5f4')
        doc.rect(MARGIN, y, 3, h).fill('#a3a3a3')
        writeInline(doc, b.text, MARGIN + 14, y + 6, contentW - 24, { color: '#333' })
        doc.y = y + h
        doc.moveDown(0.5)
      } else if (b.type === 'checkbox') {
        const box = 9
        doc.font('Helvetica').fontSize(BODY)
        const h = Math.max(box + 2, doc.heightOfString(b.text.replace(/\*\*/g, ''), { width: contentW - box - 8 }))
        ensure(h)
        const y = doc.y
        doc.lineWidth(0.8).strokeColor('#333').rect(MARGIN, y + 1.5, box, box).stroke()
        writeInline(doc, b.text, MARGIN + box + 7, y, contentW - box - 7)
        doc.moveDown(0.35)
      } else if (b.type === 'bullet') {
        doc.font('Helvetica').fontSize(BODY)
        const h = doc.heightOfString(b.text.replace(/\*\*/g, ''), { width: contentW - 14 })
        ensure(h)
        const y = doc.y
        doc.fillColor('#111').text('\u2022', MARGIN, y, { width: 12 })
        writeInline(doc, b.text, MARGIN + 14, y, contentW - 14)
        doc.moveDown(0.3)
      } else if (b.type === 'table') {
        const cols = Math.max(...b.rows.map((r) => r.length))
        const colW = contentW / cols
        const pad = 5
        for (let ri = 0; ri < b.rows.length; ri += 1) {
          const cells = Array.from({ length: cols }, (_, ci) => (b.rows[ri][ci] ?? '').replace(/\*\*/g, ''))
          const font = ri === 0 ? 'Helvetica-Bold' : 'Helvetica'
          doc.font(font).fontSize(9.5)
          const rowH = Math.max(15, ...cells.map((c) => doc.heightOfString(c || ' ', { width: colW - pad * 2 }))) + pad * 2
          ensure(rowH)
          const y0 = doc.y
          cells.forEach((c, ci) => {
            const cx = MARGIN + ci * colW
            if (ri === 0) doc.rect(cx, y0, colW, rowH).fill('#f5f5f4')
            doc.lineWidth(0.5).strokeColor('#c8c8c8').rect(cx, y0, colW, rowH).stroke()
            doc.font(font).fontSize(9.5).fillColor('#111').text(c || '', cx + pad, y0 + pad, { width: colW - pad * 2 })
          })
          doc.y = y0 + rowH
        }
        doc.moveDown(0.5)
      } else {
        doc.font('Helvetica').fontSize(BODY)
        const h = doc.heightOfString(b.text.replace(/\*\*/g, ''), { width: contentW })
        ensure(Math.min(h, 40))
        writeInline(doc, b.text, MARGIN, doc.y, contentW)
        doc.moveDown(0.5)
      }
    }
    doc.end()
  })
}

const hashes = {}
const parsed = {}
for (const file of readdirSync(srcDir).filter((f) => /^Form-(0[1-9]|1[01])-/.test(f)).sort()) {
  const id = formId(file)
  const outPath = join(outDir, `${id}.pdf`)
  const md = readFileSync(join(srcDir, file), 'utf8')
  await renderMarkdownToPdf(md, outPath)
  hashes[id] = createHash('sha256').update(readFileSync(outPath)).digest('hex')
  parsed[id] = parseItems(id, md)
}
writeFileSync(hashOut, JSON.stringify(hashes, null, 2) + '\n')
writeFileSync(parsedOut, JSON.stringify(parsed, null, 2) + '\n')
console.log('generated', Object.keys(hashes).length, 'PDFs')
