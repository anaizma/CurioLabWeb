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

function renderMarkdownToPdf(md, outPath) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 64, info: { Producer: 'CurioLab', Creator: 'CurioLab', CreationDate: new Date(0) } })
    const chunks = []
    doc.on('data', (c) => chunks.push(c))
    doc.on('end', () => { writeFileSync(outPath, Buffer.concat(chunks)); resolve() })
    for (const raw of md.split('\n')) {
      const line = raw.replace(/\*\*/g, '').replace(/^\s*[-*]\s+\[\s?\]\s*/, '\u2610 ').replace(/^\s*[-*]\s+/, '\u2022 ')
      if (/^#\s/.test(line)) { doc.moveDown(0.5).fontSize(18).text(line.replace(/^#\s/, '')); doc.fontSize(11) }
      else if (/^##\s/.test(line)) { doc.moveDown(0.4).fontSize(14).text(line.replace(/^##\s/, '')); doc.fontSize(11) }
      else if (/^###\s/.test(line)) { doc.moveDown(0.3).fontSize(12).text(line.replace(/^###\s/, '')); doc.fontSize(11) }
      else if (line.trim() === '---') { doc.moveDown(0.5) }
      else if (line.trim() === '') { doc.moveDown(0.35) }
      else { doc.fontSize(11).text(line) }
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
