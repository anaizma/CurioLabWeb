# Guardian Consent Forms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the parent-portal consent mock with a real guardian-facing flow that reads display-only PDFs of Forms 01–11, completes consent controls in the app layer (checkboxes, typed fields, drawn signature), remembers values across forms, persists an immutable per-form audit record, and drives the existing `consent_grant` ledger.

**Architecture:** Additive. Pre-generated display-only PDFs + an authoritative catalog in `packages/app` (auto-parsed `- [ ]` items + a curated required/grant/field overlay). Three new tables via migration `0039` (immutable `consent_form_completion` + `consent_signature` as the evidence artifact, mutable `guardian_saved_field` autofill store, mutable `consent_form_draft`). A `ConsentFormService` validates a submission and drives `ConsentGrantService.captureGrant`, so the form completion's id becomes the grant's `evidence_artifact_ref`. HTTP controllers mirror `guardian.ts`; the parent-portal UI uses react-pdf, autofill chips, a signature canvas, and a swappable Elevated-verification hook.

**Tech Stack:** TypeScript, Next.js 16.2.10 (App Router, `--webpack`), React 19, Postgres + `postgres` (`Sql`) + Drizzle, pdfkit (build-time PDF gen), react-pdf/pdf.js (viewer), vitest + embedded-postgres (tests), Tailwind v4.

**House rules (do not violate):**
- **AGENTS.md:** this Next.js differs from training priors. Before writing any route handler, read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`. Route handlers here use `RouteContext<'/api/...'>` and `await ctx.params` (params is a Promise), `cookies()` is async.
- Append-only tables are enforced by the `reject_append_only_mutation()` trigger **and** role-level `REVOKE` — never write an UPDATE/DELETE path against them.
- Every migration ships with a red-before-green schema test witnessed at `CURIOLAB_MIGRATE_UPTO=<prev>`.
- Services are framework-agnostic: inject `sql`, `authorize`, `config`, and a `now` clock. Mirror `packages/app/src/consent-grant.ts`.
- Commit after each green step.

---

## Shared type contract (used across tasks — keep names identical)

Defined in Task 5 (`packages/app/src/consent-forms/types.ts`). Referenced everywhere:

```ts
import type { ConsentGrantType, ConsentGrantMethod } from '../config.js'

export type FormAudience = 'guardian' | 'mentor' | 'student'
export type FieldInputType = 'text' | 'date' | 'tel' | 'email'
export type FormStatus = 'not_started' | 'in_progress' | 'complete'

/** One parsed "- [ ]" clause. Client-safe. */
export interface FormItemSchema {
  itemKey: string        // stable, e.g. "form-02:item-3"
  text: string           // the clause text after "- [ ]"
  required: boolean      // from the curated overlay
  elevated: boolean      // per-item elevated (e.g. Form 03 public sub-items)
}

/** One fill-in blank. Curated (NOT auto-parsed). Client-safe. */
export interface FormFieldSchema {
  fieldType: string      // the autofill key: guardian_name, relationship, date, child_name, child_dob, ...
  label: string
  inputType: FieldInputType
  required: boolean
}

/** The client-safe schema delivered by the API (no grant mappings). */
export interface FormClientSchema {
  formId: string         // "form-02"
  documentId: string     // "CL-CONSENT-02"
  version: string        // "2026.03"
  title: string
  audience: FormAudience
  elevated: boolean      // form-level
  pdfPath: string        // "/consent-forms/form-02.pdf"
  pdfSha256: string
  items: FormItemSchema[]
  fields: FormFieldSchema[]
}

/** Server-only: adds the grant mapping per item. */
export interface CatalogItem extends FormItemSchema {
  grantMapping?: ConsentGrantType
}
export interface CatalogForm extends Omit<FormClientSchema, 'items'> {
  items: CatalogItem[]
}

export interface FormListEntry {
  schema: FormClientSchema
  status: FormStatus
}

/** The submit / draft payload from the client. */
export interface FormSubmitPayload {
  itemStates: Record<string, boolean>   // EVERY item key -> checked (unchecked = explicit false)
  fieldValues: Record<string, string>
  signature: string                     // data URL, "data:image/png;base64,..."
  pdfSha256: string                     // sha256 the CLIENT computed over the fetched PDF bytes
  verification?: { method: ConsentGrantMethod; evidenceArtifactRef?: string | null }
}
```

---

## Phase 0 — Source assets & PDF generation

### Task 1: Add the source Markdown forms

**Files:**
- Create: `content/consent-forms/Form-00-Master-Terms.md` … `Form-11-Age-of-Majority-Transfer.md` (all 12, verbatim from the attorney-review drafts supplied).

- [ ] **Step 1: Write the 12 Markdown files** verbatim from the supplied Forms 00–11 (00 is reference only). Use the exact filenames `Form-00-Master-Terms.md`, `Form-01-Onboarding-Consent.md`, `Form-02-Public-Publication-Consent.md`, `Form-03-Likeness-Release.md`, `Form-04-Direct-Messaging-Consent.md`, `Form-05-Verification-Link-Acknowledgment.md`, `Form-06-Emergency-Medical-Authorization.md`, `Form-07-Pickup-Release-Authorization.md`, `Form-08-Mentor-Code-of-Conduct.md`, `Form-09-Background-Check-Authorization.md`, `Form-10-Volunteer-Role-Agreement.md`, `Form-11-Age-of-Majority-Transfer.md`.

- [ ] **Step 2: Commit**

```bash
git add content/consent-forms
git commit -m "content(consent): add source markdown for Forms 00-11"
```

> Note for the executor: the orchestrator supplies the exact Markdown content (it is user-provided input, not code). Do not paraphrase — the PDF is the authoritative legal text.

---

### Task 2: PDF generator (pdfkit) + pinned hashes

**Files:**
- Create: `scripts/consent-forms/generate-pdfs.mjs`
- Create (generated): `public/consent-forms/form-01.pdf` … `form-11.pdf`
- Create (generated): `packages/app/src/consent-forms/pdf-hashes.json`
- Create (generated): `packages/app/src/consent-forms/parsed-items.json` (bundler-safe parsed clauses, so the catalog never reads the filesystem at runtime)
- Modify: root `package.json` (add `pdfkit` devDependency + a `consent:pdfs` script)

- [ ] **Step 1: Add pdfkit as a dev dependency**

Run: `npm install --save-dev pdfkit@^0.15.0`
Expected: `pdfkit` appears under `devDependencies`.

- [ ] **Step 2: Write the generator** `scripts/consent-forms/generate-pdfs.mjs`

A minimal Markdown→PDF renderer (headings, bullets, `- [ ]` checkboxes as `☐`, tables flattened to lines, bold stripped). Determinism: fixed `CreationDate` (epoch) and fixed `Producer`. It renders Forms **01–11** (skips 00), then hashes each written file.

```js
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

// "Form-02-Public-Publication-Consent.md" -> "form-02"
const formId = (file) => 'form-' + file.match(/^Form-(\d\d)-/)[1]

function renderMarkdownToPdf(md, outPath) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 64, info: { Producer: 'CurioLab', Creator: 'CurioLab', CreationDate: new Date(0) } })
    const chunks = []
    doc.on('data', (c) => chunks.push(c))
    doc.on('end', () => { writeFileSync(outPath, Buffer.concat(chunks)); resolve() })
    for (const raw of md.split('\n')) {
      const line = raw.replace(/\*\*/g, '').replace(/^\s*[-*]\s+\[\s?\]\s*/, '☐ ').replace(/^\s*[-*]\s+/, '• ')
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
```

- [ ] **Step 3: Add the script to root `package.json` `scripts`**

```json
"consent:pdfs": "node scripts/consent-forms/generate-pdfs.mjs"
```

- [ ] **Step 4: Run the generator**

Run: `npm run consent:pdfs`
Expected: `generated 11 PDFs`; `public/consent-forms/form-01.pdf`…`form-11.pdf` and `packages/app/src/consent-forms/pdf-hashes.json` exist.

- [ ] **Step 5: Commit**

```bash
git add scripts/consent-forms public/consent-forms packages/app/src/consent-forms/pdf-hashes.json packages/app/src/consent-forms/parsed-items.json package.json package-lock.json
git commit -m "feat(consent): generate display-only PDFs for Forms 01-11 with pinned hashes"
```

---

### Task 3: PDF-hash integrity test (served bytes == pinned)

**Files:**
- Create: `test/consent-forms/pdf-hash.test.ts` (root vitest, `npm run test:web`)

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import hashes from '../../packages/app/src/consent-forms/pdf-hashes.json'

const pubDir = join(process.cwd(), 'public', 'consent-forms')

describe('committed consent PDFs match the pinned hashes', () => {
  test('every form-NN.pdf hashes to its pinned value', () => {
    const files = readdirSync(pubDir).filter((f) => f.endsWith('.pdf'))
    expect(files.length).toBe(11)
    for (const f of files) {
      const id = f.replace('.pdf', '')
      const sha = createHash('sha256').update(readFileSync(join(pubDir, f))).digest('hex')
      expect(sha, `${id} hash drifted from pinned`).toBe((hashes as Record<string, string>)[id])
    }
  })
})
```

- [ ] **Step 2: Run it**

Run: `npm run test:web -- test/consent-forms/pdf-hash.test.ts`
Expected: PASS (11 files match). If the root vitest config excludes `test/`, add that path to its `include`.

- [ ] **Step 3: Commit**

```bash
git add test/consent-forms/pdf-hash.test.ts
git commit -m "test(consent): pin committed PDF bytes to their hashes"
```

---

## Phase 1 — Catalog

### Task 4: Checkbox parser

**Files:**
- Create: `packages/app/src/consent-forms/parse.ts`
- Test: `packages/app/test/consent-forms-parse.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'vitest'
import { parseFormItems } from '../src/consent-forms/parse.js'

describe('parseFormItems', () => {
  test('extracts each "- [ ]" clause with a stable key and text', () => {
    const md = [
      '## 1. What you would be allowing',
      '- [ ] Publish my child’s project work (code, description, result).',
      'Some prose.',
      '- [ ] Show my child’s first name and last initial with published work.',
    ].join('\n')
    const items = parseFormItems('form-02', md)
    expect(items).toEqual([
      { itemKey: 'form-02:item-1', text: 'Publish my child’s project work (code, description, result).' },
      { itemKey: 'form-02:item-2', text: 'Show my child’s first name and last initial with published work.' },
    ])
  })

  test('ignores non-checkbox bullets', () => {
    expect(parseFormItems('form-x', '- plain bullet\n- [ ] real item')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w @curiolab/app -- consent-forms-parse`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `packages/app/src/consent-forms/parse.ts`

```ts
export interface ParsedItem {
  itemKey: string
  text: string
}

/** Extract every "- [ ]" / "* [ ]" checkbox clause, in order, with a stable key. */
export function parseFormItems(formId: string, markdown: string): ParsedItem[] {
  const out: ParsedItem[] = []
  let n = 0
  for (const line of markdown.split('\n')) {
    const m = line.match(/^\s*[-*]\s+\[\s?\]\s+(.*\S)\s*$/)
    if (m) {
      n += 1
      out.push({ itemKey: `${formId}:item-${n}`, text: m[1] })
    }
  }
  return out
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w @curiolab/app -- consent-forms-parse`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/consent-forms/parse.ts packages/app/test/consent-forms-parse.test.ts
git commit -m "feat(consent): parse checkbox clauses from form markdown"
```

---

### Task 5: Types + catalog (curated overlay)

**Files:**
- Create: `packages/app/src/consent-forms/types.ts` (the Shared type contract above)
- Create: `packages/app/src/consent-forms/catalog.ts`
- Test: `packages/app/test/consent-forms-catalog.test.ts`

- [ ] **Step 1: Write `types.ts`** — paste the entire "Shared type contract" block above.

- [ ] **Step 2: Write the failing catalog test**

```ts
import { describe, expect, test } from 'vitest'
import { CATALOG, getCatalogForm, toClientSchema } from '../src/consent-forms/catalog.js'

describe('consent form catalog', () => {
  test('all 11 forms are present with pinned hashes', () => {
    expect(CATALOG).toHaveLength(11)
    for (const f of CATALOG) {
      expect(f.pdfSha256).toMatch(/^[0-9a-f]{64}$/)
      expect(f.pdfPath).toBe(`/consent-forms/${f.formId}.pdf`)
      expect(f.items.length).toBeGreaterThan(0)
    }
  })

  test('form-02 is elevated, guardian audience, maps public_publication', () => {
    const f = getCatalogForm('form-02')!
    expect(f.audience).toBe('guardian')
    expect(f.elevated).toBe(true)
    expect(f.items.some((i) => i.grantMapping === 'public_publication')).toBe(true)
  })

  test('the client projection drops grant mappings', () => {
    const client = toClientSchema(getCatalogForm('form-02')!)
    expect((client.items[0] as Record<string, unknown>).grantMapping).toBeUndefined()
    expect(client.items[0].itemKey).toContain('form-02:item-')
  })

  test('guardian forms are exactly 01-07', () => {
    expect(CATALOG.filter((f) => f.audience === 'guardian').map((f) => f.formId).sort())
      .toEqual(['form-01','form-02','form-03','form-04','form-05','form-06','form-07'])
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm run test -w @curiolab/app -- consent-forms-catalog`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `catalog.ts`**

Build each form from the pre-generated static JSON (`parsed-items.json` + `pdf-hashes.json` — bundler-safe, no runtime filesystem read), then apply the curated overlay (required/elevated/grantMapping per item + the fields list).

```ts
import parsedItems from './parsed-items.json'
import pdfHashes from './pdf-hashes.json'
import type { CatalogForm, CatalogItem, FormClientSchema, FormFieldSchema, FormAudience } from './types.js'
import type { ConsentGrantType } from '../config.js'

type ParsedItems = Record<string, { itemKey: string; text: string }[]>

interface Overlay {
  file: string
  documentId: string
  version: string
  title: string
  audience: FormAudience
  elevated: boolean
  /** Per-item overlay, keyed by 1-based item index (matches parse order). */
  items: Record<number, { required?: boolean; elevated?: boolean; grantMapping?: ConsentGrantType }>
  fields: FormFieldSchema[]
}

const T = (fieldType: string, label: string, inputType: FormFieldSchema['inputType'] = 'text', required = true): FormFieldSchema =>
  ({ fieldType, label, inputType, required })

// The curated, legal-sensitive overlay. Item indices are 1-based in parse order.
// Required flags, elevated sub-items, grant mappings, and fill-in fields are
// decided here (never auto-derived from "- [ ]").
const OVERLAYS: Overlay[] = [
  {
    file: 'Form-01-Onboarding-Consent.md', documentId: 'CL-CONSENT-01', version: '2026.03',
    title: 'Enrollment and Account Setup', audience: 'guardian', elevated: false,
    items: {
      1: { required: true, grantMapping: 'program_participation' }, // Part A confirmations
      2: { required: true }, 3: { required: true },
      4: { required: true, grantMapping: 'program_participation' }, // Part B
      5: { required: true }, 6: { required: true }, 7: { required: true },
      8: { required: true, grantMapping: 'platform_account' },      // Part C1 (required)
      9: { required: false },                                       // Part C2 (optional chapter visibility)
    },
    fields: [
      T('child_name', "Child's full name"), T('child_dob', 'Date of birth', 'date'),
      T('guardian_name', "Guardian's full name"), T('relationship', 'Relationship to child'),
      T('guardian_email', 'Guardian email', 'email'), T('guardian_phone', 'Guardian phone', 'tel'),
      T('date', 'Date', 'date'),
    ],
  },
  {
    file: 'Form-02-Public-Publication-Consent.md', documentId: 'CL-CONSENT-02', version: '2026.03',
    title: 'Publishing Your Child’s Work Publicly', audience: 'guardian', elevated: true,
    items: { 1: { grantMapping: 'public_publication' }, 2: {}, 3: {}, 4: {}, 5: {}, 6: {}, 7: {} },
    fields: [ T('guardian_name', 'Guardian signature name'), T('relationship', 'Relationship to child'), T('date', 'Date', 'date') ],
  },
  {
    file: 'Form-03-Likeness-Release.md', documentId: 'CL-CONSENT-03', version: '2026.03',
    title: 'Photograph and Video Release', audience: 'guardian', elevated: false,
    // public sub-items are elevated; internal ones are not (per the form's own split)
    items: { 1: {}, 2: {}, 3: { grantMapping: 'photo_video_likeness' }, 4: { grantMapping: 'photo_video_likeness' },
             5: { elevated: true, grantMapping: 'photo_video_likeness' }, 6: { elevated: true, grantMapping: 'photo_video_likeness' },
             7: { elevated: true, grantMapping: 'photo_video_likeness' }, 8: {}, 9: {}, 10: {} },
    fields: [ T('guardian_name', 'Guardian signature name'), T('relationship', 'Relationship to child'), T('date', 'Date', 'date') ],
  },
  {
    file: 'Form-04-Direct-Messaging-Consent.md', documentId: 'CL-CONSENT-04', version: '2026.03',
    title: 'Direct Messages Between Your Child and Their Mentor', audience: 'guardian', elevated: true,
    items: { 1: { grantMapping: 'mentor_dm' }, 2: {}, 3: {} },
    fields: [ T('guardian_name', 'Guardian signature name'), T('relationship', 'Relationship to child'), T('date', 'Date', 'date') ],
  },
  {
    file: 'Form-05-Verification-Link-Acknowledgment.md', documentId: 'CL-CONSENT-05', version: '2026.03',
    title: 'Shareable Verification Link Acknowledgment', audience: 'guardian', elevated: false,
    items: { 1: { grantMapping: 'verification_link_sharing' }, 2: {}, 3: {}, 4: {}, 5: {} },
    fields: [ T('guardian_name', 'Guardian signature name'), T('relationship', 'Relationship to child'), T('date', 'Date', 'date') ],
  },
  {
    file: 'Form-06-Emergency-Medical-Authorization.md', documentId: 'CL-CONSENT-06', version: '2026.03',
    title: 'Emergency Contact and Medical Authorization', audience: 'guardian', elevated: false,
    items: { 1: { grantMapping: 'emergency_medical_pickup' }, 2: { grantMapping: 'emergency_medical_pickup' }, 3: {}, 4: {} },
    fields: [ T('guardian_name', 'Guardian name'), T('guardian_phone', 'Phone', 'tel'),
              T('second_contact', 'Second contact'), T('relationship', 'Relationship to child'), T('date', 'Date', 'date') ],
  },
  {
    file: 'Form-07-Pickup-Release-Authorization.md', documentId: 'CL-CONSENT-07', version: '2026.03',
    title: 'Pickup and Release Authorization', audience: 'guardian', elevated: false,
    items: { 1: { grantMapping: 'emergency_medical_pickup' }, 2: { grantMapping: 'emergency_medical_pickup' }, 3: {} },
    fields: [ T('guardian_name', 'Guardian signature name'), T('relationship', 'Relationship to child'), T('date', 'Date', 'date') ],
  },
  {
    file: 'Form-08-Mentor-Code-of-Conduct.md', documentId: 'CL-CONSENT-08', version: '2026.03',
    title: 'Mentor Code of Conduct and Acceptable Use', audience: 'mentor', elevated: false,
    items: { 1: { required: true } },
    fields: [ T('mentor_name', 'Mentor name'), T('date', 'Date', 'date') ],
  },
  {
    file: 'Form-09-Background-Check-Authorization.md', documentId: 'CL-CONSENT-09', version: '2026.03',
    title: 'Background Check Disclosure and Authorization', audience: 'mentor', elevated: false,
    items: { 1: { required: true }, 2: { required: true } },
    fields: [ T('mentor_name', 'Name'), T('date', 'Date', 'date') ],
  },
  {
    file: 'Form-10-Volunteer-Role-Agreement.md', documentId: 'CL-CONSENT-10', version: '2026.03',
    title: 'Volunteer and Role Agreement', audience: 'mentor', elevated: false,
    items: { 1: { required: true } },
    fields: [ T('mentor_name', 'Name'), T('date', 'Date', 'date') ],
  },
  {
    file: 'Form-11-Age-of-Majority-Transfer.md', documentId: 'CL-CONSENT-11', version: '2026.03',
    title: 'Age of Majority Transfer Acknowledgment', audience: 'student', elevated: false,
    items: { 1: {}, 2: {}, 3: {}, 4: {}, 5: {} },
    fields: [ T('student_name', 'Student name'), T('date', 'Date', 'date') ],
  },
]

function buildForm(o: Overlay): CatalogForm {
  const formId = 'form-' + o.file.match(/^Form-(\d\d)-/)![1]
  const parsed = (parsedItems as ParsedItems)[formId] ?? []
  const items: CatalogItem[] = parsed.map((p, idx) => {
    const ov = o.items[idx + 1] ?? {}
    return { itemKey: p.itemKey, text: p.text, required: ov.required ?? false, elevated: ov.elevated ?? false, grantMapping: ov.grantMapping }
  })
  return {
    formId, documentId: o.documentId, version: o.version, title: o.title, audience: o.audience,
    elevated: o.elevated, pdfPath: `/consent-forms/${formId}.pdf`,
    pdfSha256: (pdfHashes as Record<string, string>)[formId], items, fields: o.fields,
  }
}

export const CATALOG: CatalogForm[] = OVERLAYS.map(buildForm)

export function getCatalogForm(formId: string): CatalogForm | undefined {
  return CATALOG.find((f) => f.formId === formId)
}

/** Strip server-only fields (grantMapping) for the client. */
export function toClientSchema(f: CatalogForm): FormClientSchema {
  return { ...f, items: f.items.map(({ itemKey, text, required, elevated }) => ({ itemKey, text, required, elevated })) }
}
```

> If an overlay's item count disagrees with the parsed count, the test in Step 6 of Task 4/5 will surface it. Adjust the overlay indices to match the actual number of `- [ ]` clauses in each committed Markdown file.

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test -w @curiolab/app -- consent-forms-catalog`
Expected: PASS. If an assertion about item counts/grant mappings fails, reconcile the overlay indices with the real parsed clauses.

- [ ] **Step 6: Export from the app package** — add to `packages/app/src/index.ts`:

```ts
export { CATALOG, getCatalogForm, toClientSchema } from './consent-forms/catalog.js'
export type {
  FormAudience, FieldInputType, FormStatus, FormItemSchema, FormFieldSchema,
  FormClientSchema, CatalogItem, CatalogForm, FormListEntry, FormSubmitPayload,
} from './consent-forms/types.js'
```

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/consent-forms packages/app/src/index.ts packages/app/test/consent-forms-catalog.test.ts
git commit -m "feat(consent): authoritative form catalog with curated grant/required overlay"
```

---

## Phase 2 — Database (migration 0039)

### Task 6: Red-state schema test

**Files:**
- Create: `packages/db/test/consent-forms-schema.test.ts`

- [ ] **Step 1: Write the schema test** (red-before-green witnessed at `CURIOLAB_MIGRATE_UPTO=0038`)

```ts
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startHarness, type Harness } from './helpers/pg.js'

let h: Harness
beforeAll(async () => { h = await startHarness({ uptoInclusive: process.env.CURIOLAB_MIGRATE_UPTO }) }, 240_000)
afterAll(async () => { await h?.end() })

async function account(dob = '1990-01-01'): Promise<string> {
  const [r] = await h.sql`
    insert into account (email, username, legal_name, display_name, date_of_birth,
      dob_provenance, dob_source_ref, credential_owner, status, maturation_state)
    values (${`a-${randomUUID().slice(0,8)}@ex.test`}, ${null}, 'A', 'A', ${dob},
      'self_reported', ${null}, 'self_private', 'active', 'self_managed') returning id`
  return r!.id as string
}

async function completion(signer: string, subject: string | null) {
  const cid = randomUUID()
  const [sig] = await h.sql`
    insert into consent_signature (completion_id, image, binding)
    values (${cid}, ${Buffer.from('PNG')}, ${h.sql.json({ formId: 'form-01' })}) returning id`
  const [c] = await h.sql`
    insert into consent_form_completion (id, form_id, form_version, pdf_sha256,
      subject_student_account_id, signer_account_id, audience, item_states, field_values, signature_ref)
    values (${cid}, 'form-01', '2026.03', ${'a'.repeat(64)}, ${subject}, ${signer}, 'guardian',
      ${h.sql.json({ 'form-01:item-1': true })}, ${h.sql.json({ guardian_name: 'X' })}, ${sig!.id})
    returning id`
  return c!.id as string
}

describe('consent_form_completion (append-only)', () => {
  test('inserts and rejects UPDATE/DELETE', async () => {
    const g = await account(); const s = await account('2015-01-01')
    const id = await completion(g, s)
    expect(id).toBeTruthy()
    await expect(h.sql`update consent_form_completion set audience = 'x' where id = ${id}`).rejects.toThrow(/append-only/i)
    await expect(h.sql`delete from consent_form_completion where id = ${id}`).rejects.toThrow(/append-only/i)
  })
})

describe('consent_signature (append-only)', () => {
  test('rejects UPDATE/DELETE', async () => {
    const g = await account(); const s = await account('2015-01-01'); await completion(g, s)
    const [row] = await h.sql`select id from consent_signature limit 1`
    await expect(h.sql`update consent_signature set width = 1 where id = ${row!.id}`).rejects.toThrow(/append-only/i)
    await expect(h.sql`delete from consent_signature where id = ${row!.id}`).rejects.toThrow(/append-only/i)
  })
})

describe('guardian_saved_field (mutable, upsert)', () => {
  test('upserts on (guardian, field_type)', async () => {
    const g = await account()
    await h.sql`insert into guardian_saved_field (guardian_account_id, field_type, value_text)
      values (${g}, 'guardian_name', 'First')`
    await h.sql`insert into guardian_saved_field (guardian_account_id, field_type, value_text)
      values (${g}, 'guardian_name', 'Second')
      on conflict (guardian_account_id, field_type) do update set value_text = excluded.value_text, updated_at = now()`
    const [row] = await h.sql`select value_text from guardian_saved_field where guardian_account_id = ${g} and field_type = 'guardian_name'`
    expect(row!.value_text).toBe('Second')
  })
})

describe('consent_form_draft (mutable)', () => {
  test('inserts and updates', async () => {
    const g = await account(); const s = await account('2015-01-01')
    await h.sql`insert into consent_form_draft (guardian_account_id, subject_student_account_id, form_id, item_states)
      values (${g}, ${s}, 'form-02', ${h.sql.json({ a: true })})`
    const upd = await h.sql`update consent_form_draft set item_states = ${h.sql.json({ a: false })}
      where guardian_account_id = ${g} and subject_student_account_id = ${s} and form_id = 'form-02' returning form_id`
    expect(upd.length).toBe(1)
  })
})

describe('Mechanism A roles', () => {
  test('app may SELECT/INSERT completion + signature, not UPDATE/DELETE', async () => {
    const g = await account(); const s = await account('2015-01-01')
    const app = h.connectAs('curiolab_app', 'app_pw')
    const cid = randomUUID()
    const sig = await app`insert into consent_signature (completion_id, image, binding)
      values (${cid}, ${Buffer.from('P')}, ${app.json({})}) returning id`
    await app`insert into consent_form_completion (id, form_id, form_version, pdf_sha256, subject_student_account_id,
      signer_account_id, audience, item_states, field_values, signature_ref)
      values (${cid}, 'form-01', '2026.03', ${'a'.repeat(64)}, ${s}, ${g}, 'guardian', ${app.json({})}, ${app.json({})}, ${sig[0]!.id})`
    await expect(app`update consent_form_completion set audience = 'x' where id = ${cid}`).rejects.toThrow(/permission denied|append-only/i)
  })

  test('analytics denied SELECT on completion (minor-adjacent)', async () => {
    const analytics = h.connectAs('curiolab_analytics', 'analytics_pw')
    await expect(analytics`select 1 from consent_form_completion limit 1`).rejects.toThrow(/permission denied/i)
  })
})
```

- [ ] **Step 2: Witness red**

Run: `CURIOLAB_MIGRATE_UPTO=0038 npm run test -w @curiolab/db -- consent-forms-schema`
Expected: FAIL (`relation "consent_form_completion" does not exist`). (On Windows PowerShell: `$env:CURIOLAB_MIGRATE_UPTO='0038'; npm run test -w @curiolab/db -- consent-forms-schema; Remove-Item Env:CURIOLAB_MIGRATE_UPTO`.)

---

### Task 7: Migration 0039 + Drizzle schema

**Files:**
- Create: `packages/db/migrations/0039_consent_forms.sql`
- Modify: `packages/db/src/schema.ts` (append the 4 tables, mirroring `consent_grant`)

- [ ] **Step 1: Write the migration** `packages/db/migrations/0039_consent_forms.sql`

```sql
-- =========================================================================
-- 0039_consent_forms.sql — guardian consent-form completion + signature store.
-- ADDITIVE. Two append-only ledgers (the immutable per-form audit record and its
-- bound signature — together the evidence artifact referenced by consent_grant.
-- evidence_artifact_ref), plus two mutable per-guardian work tables (the autofill
-- store and the in-progress draft). Append-only via reject_append_only_mutation()
-- + role REVOKE, mirroring 0024. Red state witnessed at CURIOLAB_MIGRATE_UPTO=0038.
-- =========================================================================

-- --- consent_form_completion (append-only, the evidence artifact) ----------
CREATE TABLE consent_form_completion (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq                        bigserial NOT NULL UNIQUE,
  form_id                    text NOT NULL,
  form_version               text NOT NULL,
  pdf_sha256                 text NOT NULL,
  subject_student_account_id uuid REFERENCES account (id),   -- null for adult/self forms
  signer_account_id          uuid NOT NULL REFERENCES account (id),
  audience                   text NOT NULL,
  item_states                jsonb NOT NULL,                 -- { itemKey: boolean } for EVERY item
  field_values               jsonb NOT NULL,                 -- { fieldType: string }
  signature_ref              uuid NOT NULL,                  -- -> consent_signature.id (same tx)
  verification               jsonb,                          -- elevated method + evidence; null otherwise
  submitted_at               timestamptz NOT NULL DEFAULT now(),
  created_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consent_form_completion_subject_idx
  ON consent_form_completion (subject_student_account_id, form_id, seq DESC);
CREATE INDEX consent_form_completion_signer_idx
  ON consent_form_completion (signer_account_id, form_id, seq DESC);

-- --- consent_signature (append-only) ---------------------------------------
-- One row per submit; a reused signature copies its bytes into a fresh bound row.
-- completion_id is the parent completion's PRE-GENERATED id (set at insert; no
-- backfill UPDATE, since this table is append-only).
CREATE TABLE consent_signature (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq           bigserial NOT NULL UNIQUE,
  completion_id uuid NOT NULL,
  image         bytea NOT NULL,
  width         integer,
  height        integer,
  captured_at   timestamptz NOT NULL DEFAULT now(),
  binding       jsonb NOT NULL,                              -- { formId, formVersion, pdfSha256, timestamp }
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consent_signature_completion_idx ON consent_signature (completion_id);

-- --- guardian_saved_field (mutable — the autofill store) -------------------
CREATE TABLE guardian_saved_field (
  guardian_account_id uuid NOT NULL REFERENCES account (id),
  field_type          text NOT NULL,
  value_text          text,
  value_blob          bytea,                                 -- signature bytes when field_type = 'signature'
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guardian_account_id, field_type)
);

-- --- consent_form_draft (mutable — leave/resume) ---------------------------
CREATE TABLE consent_form_draft (
  guardian_account_id        uuid NOT NULL REFERENCES account (id),
  subject_student_account_id uuid REFERENCES account (id),
  form_id                    text NOT NULL,
  item_states                jsonb,
  field_values               jsonb,
  signature                  bytea,
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guardian_account_id, subject_student_account_id, form_id)
);

-- --- Append-only enforcement (shares the 0001 function) --------------------
CREATE TRIGGER consent_form_completion_append_only
  BEFORE UPDATE OR DELETE ON consent_form_completion
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER consent_signature_append_only
  BEFORE UPDATE OR DELETE ON consent_signature
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

-- --- Mechanism A grants ----------------------------------------------------
-- Append-only ledgers: SELECT+INSERT only. Mutable work tables: +UPDATE (+DELETE
-- for the draft, which is discarded on submit). Analytics denied SELECT on all
-- four (minor-adjacent, default-deny — the consent / consent_grant stance).
GRANT SELECT, INSERT ON consent_form_completion TO curiolab_app, curiolab_rls;
GRANT SELECT, INSERT ON consent_signature TO curiolab_app, curiolab_rls;
GRANT SELECT, INSERT, UPDATE, DELETE ON guardian_saved_field TO curiolab_app, curiolab_rls;
GRANT SELECT, INSERT, UPDATE, DELETE ON consent_form_draft TO curiolab_app, curiolab_rls;
GRANT USAGE, SELECT ON SEQUENCE consent_form_completion_seq_seq TO curiolab_app, curiolab_rls;
GRANT USAGE, SELECT ON SEQUENCE consent_signature_seq_seq TO curiolab_app, curiolab_rls;
```

- [ ] **Step 2: Add Drizzle tables to `packages/db/src/schema.ts`** (end of file; mirror `consentGrant`'s style — import helpers already in scope: `pgTable, uuid, text, jsonb, timestamp, bigserial, integer, index, customType`/`bytea`). Use the existing bytea column helper if the file defines one; otherwise:

```ts
import { customType } from 'drizzle-orm/pg-core'
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' })

export const consentFormCompletion = pgTable('consent_form_completion', {
  id: uuid('id').primaryKey().defaultRandom(),
  seq: bigserial('seq', { mode: 'bigint' }).notNull().unique(),
  formId: text('form_id').notNull(),
  formVersion: text('form_version').notNull(),
  pdfSha256: text('pdf_sha256').notNull(),
  subjectStudentAccountId: uuid('subject_student_account_id').references(() => account.id),
  signerAccountId: uuid('signer_account_id').notNull().references(() => account.id),
  audience: text('audience').notNull(),
  itemStates: jsonb('item_states').notNull(),
  fieldValues: jsonb('field_values').notNull(),
  signatureRef: uuid('signature_ref').notNull(),
  verification: jsonb('verification'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
}, (t) => [
  index('consent_form_completion_subject_idx').on(t.subjectStudentAccountId, t.formId, t.seq),
  index('consent_form_completion_signer_idx').on(t.signerAccountId, t.formId, t.seq),
])

export const consentSignature = pgTable('consent_signature', {
  id: uuid('id').primaryKey().defaultRandom(),
  seq: bigserial('seq', { mode: 'bigint' }).notNull().unique(),
  completionId: uuid('completion_id').notNull(),
  image: bytea('image').notNull(),
  width: integer('width'),
  height: integer('height'),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  binding: jsonb('binding').notNull(),
  createdAt: createdAt(),
}, (t) => [index('consent_signature_completion_idx').on(t.completionId)])

export const guardianSavedField = pgTable('guardian_saved_field', {
  guardianAccountId: uuid('guardian_account_id').notNull().references(() => account.id),
  fieldType: text('field_type').notNull(),
  valueText: text('value_text'),
  valueBlob: bytea('value_blob'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.guardianAccountId, t.fieldType] })])

export const consentFormDraft = pgTable('consent_form_draft', {
  guardianAccountId: uuid('guardian_account_id').notNull().references(() => account.id),
  subjectStudentAccountId: uuid('subject_student_account_id').references(() => account.id),
  formId: text('form_id').notNull(),
  itemStates: jsonb('item_states'),
  fieldValues: jsonb('field_values'),
  signature: bytea('signature'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.guardianAccountId, t.subjectStudentAccountId, t.formId] })])
```

(Ensure `primaryKey`, `integer`, `jsonb`, `bigserial` are imported at the top of `schema.ts` — add any missing to the existing `drizzle-orm/pg-core` import.)

- [ ] **Step 3: Run green**

Run: `npm run test -w @curiolab/db -- consent-forms-schema`
Expected: PASS (all describe blocks). Also run `npm run test -w @curiolab/db -- consent-grant-schema` to confirm no regression.

- [ ] **Step 4: Typecheck the db package**

Run: `npm run typecheck -w @curiolab/db`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/db/migrations/0039_consent_forms.sql packages/db/src/schema.ts packages/db/test/consent-forms-schema.test.ts
git commit -m "feat(db): consent-form completion + signature store (migration 0039)"
```

---

## Phase 3 — Service (packages/app)

### Task 8: Service errors

**Files:**
- Modify: `packages/app/src/errors.ts` (add error classes near the grant errors)

- [ ] **Step 1: Add error classes**

```ts
export class FormNotFoundError extends Error {
  constructor(public formId: string) { super(`unknown form: ${formId}`); this.name = 'FormNotFoundError' }
}
export class FormItemRequiredError extends Error {
  constructor(public itemKey: string) { super(`required item not checked: ${itemKey}`); this.name = 'FormItemRequiredError' }
}
export class FormFieldRequiredError extends Error {
  constructor(public fieldType: string) { super(`required field missing: ${fieldType}`); this.name = 'FormFieldRequiredError' }
}
export class FormPdfHashMismatchError extends Error {
  constructor(public formId: string) { super(`pdf hash mismatch for ${formId}`); this.name = 'FormPdfHashMismatchError' }
}
export class FormElevatedVerificationRequiredError extends Error {
  constructor(public formId: string) { super(`elevated verification required for ${formId}`); this.name = 'FormElevatedVerificationRequiredError' }
}
```

- [ ] **Step 2: Map them to 4xx in `packages/http/src/respond.ts`** — find where `ValidationError` / grant errors map to statuses and add these five as `422` (validation) except `FormNotFoundError` → `404`. Follow the existing `mapError` switch/instanceof pattern exactly.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck -w @curiolab/app && npm run typecheck -w @curiolab/http`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/errors.ts packages/http/src/respond.ts
git commit -m "feat(consent): form-completion error types + http mapping"
```

---

### Task 9: ConsentFormService — reads + draft

**Files:**
- Create: `packages/app/src/consent-form-service.ts`
- Test: `packages/app/test/consent-form-service-reads.test.ts`

- [ ] **Step 1: Write the failing test** (uses the embedded-pg harness + a seeded guardian/child; reuse `packages/app/test/helpers` seeds like the grant tests do)

```ts
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { AuthContext } from '@curiolab/core'
import { startHarness, type Harness } from './helpers/pg.js'
import { baseCtx } from './helpers/ctx.js'
import { makeAdult, makeMinor } from './helpers/fixtures.js'
import { ConsentFormService } from '../src/consent-form-service.js'
import { authorize } from '@curiolab/runtime'

let h: Harness
beforeAll(async () => { h = await startHarness() }, 240_000)
afterAll(async () => { await h?.end() })

// A guardian + minor child, with the guardian scope satisfied by ctx.guardianOf —
// the exact pattern consent-grant.test.ts uses (makeAdult / makeMinor from
// helpers/fixtures.js; guardianOf set directly on the synthetic ctx).
async function seedGuardianChild(dob = '2015-06-01'): Promise<{ guardian: string; child: string; ctx: AuthContext }> {
  const guardian = await makeAdult(h.sql)
  const child = await makeMinor(h.sql, { dateOfBirth: dob })
  const ctx: AuthContext = { ...baseCtx(guardian, new Date()), guardianOf: [child] }
  return { guardian, child, ctx }
}

describe('ConsentFormService.listForms', () => {
  test('returns all 11 forms; guardian forms status not_started initially', async () => {
    const { child, ctx } = await seedGuardianChild()
    const svc = new ConsentFormService({ sql: h.sql, authorize })
    const forms = await svc.listForms(child, ctx)
    expect(forms).toHaveLength(11)
    expect(forms.find((f) => f.schema.formId === 'form-02')!.status).toBe('not_started')
  })
})

describe('ConsentFormService saved fields + draft', () => {
  test('saveDraft then getDraft round-trips; getSavedFields reads upserted values', async () => {
    const { child, ctx } = await seedGuardianChild()
    const svc = new ConsentFormService({ sql: h.sql, authorize })
    await svc.saveDraft(child, 'form-02', ctx, {
      itemStates: { 'form-02:item-1': true }, fieldValues: { guardian_name: 'Ada' },
      signature: '', pdfSha256: '',
    })
    const d = await svc.getDraft(child, 'form-02', ctx)
    expect(d!.fieldValues.guardian_name).toBe('Ada')
    const draftForm = (await svc.listForms(child, ctx)).find((f) => f.schema.formId === 'form-02')!
    expect(draftForm.status).toBe('in_progress')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w @curiolab/app -- consent-form-service-reads`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the reads half of the service** `packages/app/src/consent-form-service.ts`

```ts
import type { Sql } from 'postgres'
import type { AuthContext, Resource } from '@curiolab/core'
import { CATALOG, getCatalogForm, toClientSchema } from './consent-forms/catalog.js'
import type { FormListEntry, FormSubmitPayload, FormStatus } from './consent-forms/types.js'
import { defaultConfig, type AppConfig } from './config.js'

export interface ConsentFormServiceDeps {
  sql: Sql
  authorize: (ctx: AuthContext, cap: 'guardian.view_grants' | 'consent.grant', resource: Resource, deps: { sql: Sql }) => Promise<unknown>
  config?: Partial<AppConfig>
}

export class ConsentFormService {
  private readonly sql: Sql
  private readonly authorize: ConsentFormServiceDeps['authorize']
  private readonly config: AppConfig
  constructor(deps: ConsentFormServiceDeps) {
    this.sql = deps.sql; this.authorize = deps.authorize; this.config = { ...defaultConfig, ...deps.config }
  }

  private async childResource(childId: string): Promise<Resource> {
    const [row] = await this.sql`select date_of_birth as dob from account where id = ${childId}`
    const dob = row ? new Date(row.dob as string) : new Date()
    const age = Math.floor((Date.now() - dob.getTime()) / (365.25 * 864e5))
    return { subjectAccountId: childId, subjectAge: age, subjectIsMinor: age < 18, ownerAccountId: childId }
  }

  async listForms(childId: string, ctx: AuthContext): Promise<FormListEntry[]> {
    await this.authorize(ctx, 'guardian.view_grants', await this.childResource(childId), { sql: this.sql })
    const completions = await this.sql<{ form_id: string }[]>`
      select distinct form_id from consent_form_completion
      where signer_account_id = ${ctx.account.id} and subject_student_account_id = ${childId}`
    const drafts = await this.sql<{ form_id: string }[]>`
      select form_id from consent_form_draft
      where guardian_account_id = ${ctx.account.id} and subject_student_account_id = ${childId}`
    const done = new Set(completions.map((r) => r.form_id))
    const started = new Set(drafts.map((r) => r.form_id))
    return CATALOG.map((f) => {
      const status: FormStatus = done.has(f.formId) ? 'complete' : started.has(f.formId) ? 'in_progress' : 'not_started'
      return { schema: toClientSchema(f), status }
    })
  }

  async getSavedFields(ctx: AuthContext): Promise<{ fields: Record<string, string>; signature: string | null }> {
    const rows = await this.sql<{ field_type: string; value_text: string | null; value_blob: Buffer | null }[]>`
      select field_type, value_text, value_blob from guardian_saved_field
      where guardian_account_id = ${ctx.account.id}`
    const fields: Record<string, string> = {}
    let signature: string | null = null
    for (const r of rows) {
      if (r.field_type === 'signature') { signature = r.value_blob ? `data:image/png;base64,${r.value_blob.toString('base64')}` : null }
      else if (r.value_text != null) fields[r.field_type] = r.value_text
    }
    return { fields, signature }
  }

  async getDraft(childId: string, formId: string, ctx: AuthContext): Promise<FormSubmitPayload | null> {
    const [row] = await this.sql`
      select item_states, field_values, signature from consent_form_draft
      where guardian_account_id = ${ctx.account.id} and subject_student_account_id = ${childId} and form_id = ${formId}`
    if (!row) return null
    return {
      itemStates: (row.item_states as Record<string, boolean>) ?? {},
      fieldValues: (row.field_values as Record<string, string>) ?? {},
      signature: row.signature ? `data:image/png;base64,${(row.signature as Buffer).toString('base64')}` : '',
      pdfSha256: '',
    }
  }

  async saveDraft(childId: string, formId: string, ctx: AuthContext, payload: FormSubmitPayload): Promise<void> {
    if (!getCatalogForm(formId)) throw new Error(`unknown form: ${formId}`)
    const sigBuf = payload.signature?.startsWith('data:') ? Buffer.from(payload.signature.split(',')[1], 'base64') : null
    await this.sql`
      insert into consent_form_draft (guardian_account_id, subject_student_account_id, form_id, item_states, field_values, signature)
      values (${ctx.account.id}, ${childId}, ${formId}, ${this.sql.json(payload.itemStates)}, ${this.sql.json(payload.fieldValues)}, ${sigBuf})
      on conflict (guardian_account_id, subject_student_account_id, form_id)
      do update set item_states = excluded.item_states, field_values = excluded.field_values, signature = excluded.signature, updated_at = now()`
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w @curiolab/app -- consent-form-service-reads`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/consent-form-service.ts packages/app/test/consent-form-service-reads.test.ts
git commit -m "feat(consent): ConsentFormService reads (list, saved fields, draft)"
```

---

### Task 10: ConsentFormService — submitCompletion (drives the grant ledger)

**Files:**
- Modify: `packages/app/src/consent-form-service.ts` (add `submitCompletion`)
- Test: `packages/app/test/consent-form-service-submit.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// Reuse the same imports + harness + the seedGuardianChild(dob) helper from Task 9
// (copy it into this file — tests are self-contained). Plus:
import { ConsentGrantService } from '../src/consent-grant.js'
import { getCatalogForm } from '../src/consent-forms/catalog.js'

describe('submitCompletion drives the grant ledger', () => {
  test('a standard form (form-05) captures its grant with method click and evidence = completionId', async () => {
    const { child, ctx } = await seedGuardianChild('2015-01-01') // ~11yo
    const svc = new ConsentFormService({ sql: h.sql, authorize })
    const form = getCatalogForm('form-05')!
    const res = await svc.submitCompletion(child, 'form-05', ctx, {
      itemStates: Object.fromEntries(form.items.map((i) => [i.itemKey, true])),
      fieldValues: { guardian_name: 'Ada', relationship: 'Parent', date: '2026-07-25' },
      signature: 'data:image/png;base64,aGk=', pdfSha256: form.pdfSha256,
    })
    expect(res.completionId).toBeTruthy()
    const grants = await new ConsentGrantService({ sql: h.sql, authorize }).viewChildGrants(child, ctx)
    const vls = grants.find((g) => g.grantType === 'verification_link_sharing')!
    expect(vls.status).toBe('active')
    expect(vls.evidenceArtifactRef).toBe(res.completionId)
    expect(vls.method).toBe('click')
  })

  test('a required item unchecked is rejected', async () => {
    const { child, ctx } = await seedGuardianChild()
    const svc = new ConsentFormService({ sql: h.sql, authorize })
    await expect(svc.submitCompletion(child, 'form-01', ctx, {
      itemStates: {}, fieldValues: {}, signature: 'data:image/png;base64,aGk=', pdfSha256: getCatalogForm('form-01')!.pdfSha256,
    })).rejects.toThrow(/required item/i)
  })

  test('pdf hash mismatch is rejected', async () => {
    const { child, ctx } = await seedGuardianChild()
    const svc = new ConsentFormService({ sql: h.sql, authorize })
    const form = getCatalogForm('form-05')!
    await expect(svc.submitCompletion(child, 'form-05', ctx, {
      itemStates: Object.fromEntries(form.items.map((i) => [i.itemKey, true])),
      fieldValues: { guardian_name: 'A', relationship: 'P', date: '2026-07-25' },
      signature: 'data:image/png;base64,aGk=', pdfSha256: 'deadbeef',
    })).rejects.toThrow(/hash mismatch/i)
  })

  test('under-13 public_publication (form-02) with a reused signature ONLY is rejected; with verification it captures', async () => {
    const { child, ctx } = await seedGuardianChild('2016-01-01') // ~10yo
    const svc = new ConsentFormService({ sql: h.sql, authorize })
    const form = getCatalogForm('form-02')!
    const checkedFirst = { [form.items[0].itemKey]: true, ...Object.fromEntries(form.items.slice(1).map((i) => [i.itemKey, false])) }
    const base = { itemStates: checkedFirst, fieldValues: { guardian_name: 'A', relationship: 'P', date: '2026-07-25' }, signature: 'data:image/png;base64,aGk=', pdfSha256: form.pdfSha256 }
    await expect(svc.submitCompletion(child, 'form-02', ctx, base)).rejects.toThrow(/elevated verification/i)
    const ok = await svc.submitCompletion(child, 'form-02', ctx, { ...base, verification: { method: 'signed_form', evidenceArtifactRef: 'artifact://stub' } })
    expect(ok.completionId).toBeTruthy()
    const grants = await new ConsentGrantService({ sql: h.sql, authorize }).viewChildGrants(child, ctx)
    expect(grants.find((g) => g.grantType === 'public_publication')!.status).toBe('active')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w @curiolab/app -- consent-form-service-submit`
Expected: FAIL (`submitCompletion` is not a function).

- [ ] **Step 3: Implement `submitCompletion`** (append to the service class)

```ts
import { randomUUID } from 'node:crypto'
import { ConsentGrantService } from './consent-grant.js'
import { STRONG_GRANT_METHODS } from './config.js'
import {
  FormNotFoundError, FormItemRequiredError, FormFieldRequiredError,
  FormPdfHashMismatchError, FormElevatedVerificationRequiredError,
} from './errors.js'
import type { GrantResult } from './consent-grant.js'
import type { ConsentGrantMethod, ConsentGrantType } from './config.js'

// inside class ConsentFormService:
async submitCompletion(
  childId: string, formId: string, ctx: AuthContext, payload: FormSubmitPayload, now: Date = new Date(),
): Promise<{ completionId: string; grants: GrantResult[] }> {
  const form = getCatalogForm(formId)
  if (!form) throw new FormNotFoundError(formId)

  // 1. Completeness (every required item checked; every required field present).
  for (const item of form.items) {
    if (item.required && payload.itemStates[item.itemKey] !== true) throw new FormItemRequiredError(item.itemKey)
  }
  for (const field of form.fields) {
    if (field.required && !(payload.fieldValues[field.fieldType]?.trim())) throw new FormFieldRequiredError(field.fieldType)
  }
  // 2. Bind to the exact bytes the guardian saw.
  if (payload.pdfSha256 !== form.pdfSha256) throw new FormPdfHashMismatchError(formId)

  // 3. Elevated gate: any elevated form OR any checked elevated item requires a
  //    strong-method verification result. A reused signature alone never suffices.
  const anyCheckedElevated = form.elevated || form.items.some((i) => i.elevated && payload.itemStates[i.itemKey] === true)
  if (anyCheckedElevated) {
    const v = payload.verification
    if (!v || !STRONG_GRANT_METHODS.includes(v.method) || !v.evidenceArtifactRef) {
      throw new FormElevatedVerificationRequiredError(formId)
    }
  }

  // 4. Which grants to capture: distinct grantMappings on CHECKED items.
  const grantTypes = [...new Set(
    form.items.filter((i) => i.grantMapping && payload.itemStates[i.itemKey] === true).map((i) => i.grantMapping as ConsentGrantType),
  )]
  const method: ConsentGrantMethod = anyCheckedElevated ? (payload.verification!.method) : 'click'
  const completionId = randomUUID()
  const sigBuf = Buffer.from(payload.signature.split(',')[1] ?? '', 'base64')

  const grants = await this.sql.begin(async (tx) => {
    await tx`
      insert into consent_signature (completion_id, image, binding)
      values (${completionId}, ${sigBuf}, ${tx.json({ formId, formVersion: form.version, pdfSha256: form.pdfSha256, timestamp: now.toISOString() })})`
    const [sig] = await tx`select id from consent_signature where completion_id = ${completionId} order by seq desc limit 1`
    await tx`
      insert into consent_form_completion (id, form_id, form_version, pdf_sha256, subject_student_account_id,
        signer_account_id, audience, item_states, field_values, signature_ref, verification, submitted_at)
      values (${completionId}, ${formId}, ${form.version}, ${form.pdfSha256}, ${childId}, ${ctx.account.id},
        ${form.audience}, ${tx.json(payload.itemStates)}, ${tx.json(payload.fieldValues)}, ${sig!.id},
        ${payload.verification ? tx.json(payload.verification) : null}, ${now})`
    // remembered values (autofill) — upsert typed fields + the signature
    for (const [fieldType, value] of Object.entries(payload.fieldValues)) {
      await tx`insert into guardian_saved_field (guardian_account_id, field_type, value_text)
        values (${ctx.account.id}, ${fieldType}, ${value})
        on conflict (guardian_account_id, field_type) do update set value_text = excluded.value_text, updated_at = now()`
    }
    await tx`insert into guardian_saved_field (guardian_account_id, field_type, value_blob)
      values (${ctx.account.id}, 'signature', ${sigBuf})
      on conflict (guardian_account_id, field_type) do update set value_blob = excluded.value_blob, updated_at = now()`
    // capture grants — reuse the ledger service INSIDE this tx via a tx-bound instance
    const captured: GrantResult[] = []
    const txGrantSvc = new ConsentGrantService({ sql: tx as unknown as Sql, authorize: this.authorize as never })
    for (const grantType of grantTypes) {
      captured.push(await txGrantSvc.captureGrant(childId, grantType, ctx, { method, evidenceArtifactRef: completionId, now }))
    }
    // discard the draft
    await tx`delete from consent_form_draft
      where guardian_account_id = ${ctx.account.id} and subject_student_account_id = ${childId} and form_id = ${formId}`
    return captured
  }) as GrantResult[]

  return { completionId, grants }
}
```

> Note on the transaction: `captureGrant` opens its own `sql.begin`; passing the enclosing `tx` as its `sql` makes its inner `tx.begin` a **savepoint** (postgres.js nests `begin` as savepoints), which is correct — the whole submit is atomic. Verify this against `packages/app/src/consent-grant.ts` `captureGrant` (it calls `this.sql.begin`). If nesting misbehaves in the harness, fall back to capturing grants **after** the completion commits, in a second loop, still recording `evidenceArtifactRef = completionId`.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w @curiolab/app -- consent-form-service-submit`
Expected: PASS (all four tests).

- [ ] **Step 5: Export the service** — add to `packages/app/src/index.ts`:

```ts
export { ConsentFormService } from './consent-form-service.js'
export type { ConsentFormServiceDeps } from './consent-form-service.js'
```

- [ ] **Step 6: Full app test + typecheck**

Run: `npm run test -w @curiolab/app && npm run typecheck -w @curiolab/app`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/consent-form-service.ts packages/app/src/index.ts packages/app/test/consent-form-service-submit.test.ts
git commit -m "feat(consent): submitCompletion writes audit + drives the grant ledger"
```

---

## Phase 4 — HTTP controllers + routes

### Task 11: Controllers

**Files:**
- Create: `packages/http/src/controllers/consent-forms.ts`
- Modify: `packages/http/src/index.ts` (export the controllers)
- Test: `packages/http/test/consent-forms.test.ts`

- [ ] **Step 1: Write the failing controller test** (mirror `guardian.test.ts` — a verified guardian gets 200; another guardian 403; no session 403)

```ts
import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { startHarness, type Harness } from './helpers/pg.js'
import { onboardStudent, seedVerifiedGuardian } from './helpers/seed.js'
import { listChildForms, getSavedFields, submitFormCompletion } from '../src/index.js'
import { getCatalogForm } from '@curiolab/app'

let h: Harness
beforeAll(async () => { h = await startHarness() }, 240_000)
afterAll(async () => { await h?.end() })

describe('listChildForms', () => {
  test('a verified guardian lists 11 forms (200)', async () => {
    const s = await onboardStudent(h.sql, { activate: true })
    const { guardianToken } = await seedVerifiedGuardian(h.sql, s)
    const res = await listChildForms({ sql: h.sql, sessionToken: guardianToken, params: { id: s.accountId } })
    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(11)
  })
  test('no session is an opaque 403', async () => {
    const s = await onboardStudent(h.sql, { activate: true })
    const res = await listChildForms({ sql: h.sql, params: { id: s.accountId } })
    expect(res.status).toBe(403)
  })
})

describe('submitFormCompletion', () => {
  test('captures the grant and returns 201', async () => {
    const s = await onboardStudent(h.sql, { activate: true, dob: '2015-01-01' })
    const { guardianToken } = await seedVerifiedGuardian(h.sql, s)
    const form = getCatalogForm('form-05')!
    const res = await submitFormCompletion({
      sql: h.sql, sessionToken: guardianToken, params: { id: s.accountId, formId: 'form-05' },
      body: { itemStates: Object.fromEntries(form.items.map((i) => [i.itemKey, true])),
        fieldValues: { guardian_name: 'Ada', relationship: 'Parent', date: '2026-07-25' },
        signature: 'data:image/png;base64,aGk=', pdfSha256: form.pdfSha256 },
    })
    expect(res.status).toBe(201)
    expect(res.body.completionId).toBeTruthy()
  })
})
```

> If `onboardStudent` doesn't accept `dob`, seed the child DOB directly after onboarding (see how `consent-grant` http/app tests set a subject DOB).

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w @curiolab/http -- consent-forms`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the controllers** `packages/http/src/controllers/consent-forms.ts` (mirror `guardian.ts`: `runAuthed`, `reqStr`, `ValidationError`)

```ts
import { ConsentFormService, type FormSubmitPayload } from '@curiolab/app'
import { authorize } from '@curiolab/runtime'
import { runAuthed } from '../run.js'
import { reqStr, ValidationError } from '../respond.js'
import type { AuthedInputBase, ControllerResult } from '../types.js'

export interface ChildFormsInput extends AuthedInputBase { params: { id?: unknown } }
export interface SavedFieldsInput extends AuthedInputBase {}
export interface DraftInput extends AuthedInputBase { params: { id?: unknown; formId?: unknown }; body?: unknown }
export interface SubmitInput extends AuthedInputBase { params: { id?: unknown; formId?: unknown }; body: unknown }

export function listChildForms(input: ChildFormsInput): Promise<ControllerResult<{ items: unknown[] }>> {
  return runAuthed(input, async (ctx, sql) => {
    const childId = reqStr(input.params?.id, 'id')
    const items = await new ConsentFormService({ sql, authorize: authorize as never }).listForms(childId, ctx)
    return { status: 200, body: { items } }
  })
}

export function getSavedFields(input: SavedFieldsInput): Promise<ControllerResult<unknown>> {
  return runAuthed(input, async (ctx, sql) => {
    const body = await new ConsentFormService({ sql, authorize: authorize as never }).getSavedFields(ctx)
    return { status: 200, body }
  })
}

export function getFormDraft(input: DraftInput): Promise<ControllerResult<unknown>> {
  return runAuthed(input, async (ctx, sql) => {
    const childId = reqStr(input.params?.id, 'id'); const formId = reqStr(input.params?.formId, 'formId')
    const body = await new ConsentFormService({ sql, authorize: authorize as never }).getDraft(childId, formId, ctx)
    return { status: 200, body: body ?? {} }
  })
}

export function saveFormDraft(input: DraftInput): Promise<ControllerResult<{ ok: true }>> {
  return runAuthed(input, async (ctx, sql) => {
    const childId = reqStr(input.params?.id, 'id'); const formId = reqStr(input.params?.formId, 'formId')
    await new ConsentFormService({ sql, authorize: authorize as never }).saveDraft(childId, formId, ctx, input.body as FormSubmitPayload)
    return { status: 200, body: { ok: true } }
  })
}

export function submitFormCompletion(input: SubmitInput): Promise<ControllerResult<{ completionId: string }>> {
  return runAuthed(input, async (ctx, sql) => {
    const childId = reqStr(input.params?.id, 'id'); const formId = reqStr(input.params?.formId, 'formId')
    const b = input.body as Partial<FormSubmitPayload>
    if (!b || typeof b !== 'object' || !b.itemStates || !b.pdfSha256) throw new ValidationError('malformed submission')
    const res = await new ConsentFormService({ sql, authorize: authorize as never }).submitCompletion(childId, formId, ctx, b as FormSubmitPayload)
    return { status: 201, body: { completionId: res.completionId } }
  })
}
```

- [ ] **Step 4: Export from `packages/http/src/index.ts`**

```ts
export {
  listChildForms, getSavedFields, getFormDraft, saveFormDraft, submitFormCompletion,
} from './controllers/consent-forms.js'
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test -w @curiolab/http -- consent-forms`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/http/src/controllers/consent-forms.ts packages/http/src/index.ts packages/http/test/consent-forms.test.ts
git commit -m "feat(consent): http controllers for the guardian consent-form flow"
```

---

### Task 12: Next route handlers

**Files:**
- Create: `app/api/guardian/forms/saved-fields/route.ts`
- Create: `app/api/guardian/children/[id]/forms/route.ts`
- Create: `app/api/guardian/children/[id]/forms/[formId]/draft/route.ts`
- Create: `app/api/guardian/children/[id]/forms/[formId]/completions/route.ts`

- [ ] **Step 1: Read the Next 16 route doc** — `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`. Confirm the `RouteContext<'...'>` + `await ctx.params` + async `cookies()` conventions (already used across `app/api/guardian/**`).

- [ ] **Step 2: Write the handlers** (mirror `app/api/guardian/children/[id]/record/route.ts` exactly)

`app/api/guardian/children/[id]/forms/route.ts`:
```ts
import { cookies } from 'next/headers'
import { getSql, listChildForms, SESSION_COOKIE } from '@curiolab/http'

export async function GET(_req: Request, ctx: RouteContext<'/api/guardian/children/[id]/forms'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await listChildForms({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
```

`app/api/guardian/forms/saved-fields/route.ts`:
```ts
import { cookies } from 'next/headers'
import { getSql, getSavedFields, SESSION_COOKIE } from '@curiolab/http'

export async function GET() {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const { status, body } = await getSavedFields({ sql: getSql(), sessionToken })
  return Response.json(body, { status })
}
```

`app/api/guardian/children/[id]/forms/[formId]/draft/route.ts`:
```ts
import { cookies } from 'next/headers'
import { getSql, getFormDraft, saveFormDraft, SESSION_COOKIE } from '@curiolab/http'

export async function GET(_req: Request, ctx: RouteContext<'/api/guardian/children/[id]/forms/[formId]/draft'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await getFormDraft({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
export async function PUT(req: Request, ctx: RouteContext<'/api/guardian/children/[id]/forms/[formId]/draft'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const body = await req.json().catch(() => ({}))
  const { status, body: out } = await saveFormDraft({ sql: getSql(), sessionToken, params, body })
  return Response.json(out, { status })
}
```

`app/api/guardian/children/[id]/forms/[formId]/completions/route.ts`:
```ts
import { cookies } from 'next/headers'
import { getSql, submitFormCompletion, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request, ctx: RouteContext<'/api/guardian/children/[id]/forms/[formId]/completions'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const body = await req.json().catch(() => ({}))
  const { status, body: out } = await submitFormCompletion({ sql: getSql(), sessionToken, params, body })
  return Response.json(out, { status })
}
```

- [ ] **Step 3: Typecheck the web app**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors (the `RouteContext` generic resolves from Next's generated route types after a dev/build touch; if unrecognized, run `npm run build --webpack` once to regenerate `.next/types`).

- [ ] **Step 4: Commit**

```bash
git add app/api/guardian/forms app/api/guardian/children/\[id\]/forms
git commit -m "feat(consent): Next route handlers for the guardian consent-form flow"
```

---

## Phase 5 — Web UI (parent portal)

### Task 13: Client types + server data function

**Files:**
- Create: `lib/portal/guardian/consent-forms.ts` (client-facing types re-exported for the browser + a server fetch)

- [ ] **Step 1: Write the module** (mirror `lib/portal/guardian/guardian-data.ts` — read `cl_session`, call the API on the same origin, fall back to an empty/sample list when unauthenticated)

```ts
import { cookies, headers } from 'next/headers'

export type FormStatus = 'not_started' | 'in_progress' | 'complete'
export interface FormItemSchema { itemKey: string; text: string; required: boolean; elevated: boolean }
export interface FormFieldSchema { fieldType: string; label: string; inputType: 'text'|'date'|'tel'|'email'; required: boolean }
export interface FormClientSchema {
  formId: string; documentId: string; version: string; title: string
  audience: 'guardian'|'mentor'|'student'; elevated: boolean; pdfPath: string; pdfSha256: string
  items: FormItemSchema[]; fields: FormFieldSchema[]
}
export interface FormListEntry { schema: FormClientSchema; status: FormStatus }

async function origin(): Promise<string | null> {
  const h = await headers(); const host = h.get('host'); const proto = h.get('x-forwarded-proto') ?? 'http'
  return process.env.NEXT_PUBLIC_SITE_URL ?? (host ? `${proto}://${host}` : null)
}

/** Guardian forms for a child; null when unauthenticated (page shows the sample notice). */
export async function getChildForms(childId: string): Promise<FormListEntry[] | null> {
  try {
    const session = (await cookies()).get('cl_session'); if (!session) return null
    const o = await origin(); if (!o) return null
    const res = await fetch(`${o}/api/guardian/children/${childId}/forms`, {
      headers: { cookie: `cl_session=${session.value}` }, cache: 'no-store',
    })
    if (!res.ok) return null
    return ((await res.json()) as { items: FormListEntry[] }).items
  } catch { return null }
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit -p tsconfig.json`
```bash
git add lib/portal/guardian/consent-forms.ts
git commit -m "feat(consent): guardian consent-forms client types + server fetch"
```

---

### Task 14: PDF viewer component (react-pdf)

**Files:**
- Modify: root `package.json` (add `react-pdf`)
- Create: `components/portal/guardian/FormViewer.tsx`

- [ ] **Step 1: Install react-pdf**

Run: `npm install react-pdf@^9`
Expected: `react-pdf` in `dependencies`.

- [ ] **Step 2: Write the viewer** (swappable; paginated; worker configured)

```tsx
'use client'
import { useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

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
      <Document file={src} onLoadSuccess={(d) => { setNumPages(d.numPages); void hashBytes() }} loading={<div className="p-6 text-sm text-muted">Loading form…</div>}>
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
```

> If the CSP or offline policy forbids the unpkg worker, copy `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` into `public/` and point `workerSrc` at `/pdf.worker.min.mjs`. Do this if `npm run build --webpack` or the page errors on the worker fetch.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json components/portal/guardian/FormViewer.tsx
git commit -m "feat(consent): swappable react-pdf FormViewer with byte-hash binding"
```

---

### Task 15: Signature canvas component

**Files:**
- Create: `components/portal/guardian/SignaturePad.tsx`

- [ ] **Step 1: Write the component** (mouse + touch via Pointer Events; `value`/`onChange` as a PNG data URL; reuse + clear)

```tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add components/portal/guardian/SignaturePad.tsx
git commit -m "feat(consent): signature canvas with one-tap reuse"
```

---

### Task 16: Autofill field + Elevated verification stub

**Files:**
- Create: `components/portal/guardian/AutofillField.tsx`
- Create: `components/portal/guardian/VerificationStep.tsx`

- [ ] **Step 1: Write `AutofillField.tsx`** (browser-autofill-style suggestion chip on focus; accept/edit, never silent)

```tsx
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
```

- [ ] **Step 2: Write `VerificationStep.tsx`** (swappable stub; a deliberate action; never satisfied by a reused signature)

```tsx
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
```

- [ ] **Step 3: Commit**

```bash
git add components/portal/guardian/AutofillField.tsx components/portal/guardian/VerificationStep.tsx
git commit -m "feat(consent): autofill field chip + swappable elevated-verification stub"
```

---

### Task 17: Form editor page

**Files:**
- Create: `app/portal/parent/consent/[formId]/page.tsx` (server: resolve child + form schema)
- Create: `app/portal/parent/consent/[formId]/form-editor.tsx` (client: compose viewer + controls + submit)

- [ ] **Step 1: Write the server page** — fetch the child's forms, find `formId`, pass the schema + child id to the client. Reuse `getGuardianView()` for the child id and `getChildForms()` for the schema.

```tsx
import { getGuardianView } from '@/lib/portal/guardian/guardian-data'
import { getChildForms } from '@/lib/portal/guardian/consent-forms'
import FormEditor from './form-editor'

export default async function ConsentFormPage(props: { params: Promise<{ formId: string }> }) {
  const { formId } = await props.params
  const v = await getGuardianView()
  const forms = await getChildForms(v.child.id)
  const entry = forms?.find((f) => f.schema.formId === formId)
  if (!entry) return <div className="mx-auto max-w-3xl px-5 py-8 text-sm text-muted">Form not found.</div>
  return <FormEditor childId={v.child.id} entry={entry} isSample={v.isSample} />
}
```

- [ ] **Step 2: Write the client editor** — the composition. State: `itemStates`, `fieldValues`, `signature`, `pdfSha256`, `verification`. Autosave draft (debounced PUT). Submit POSTs completion. Blocks submit until required items checked + required fields filled + (if elevated) verified.

```tsx
'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { FormListEntry } from '@/lib/portal/guardian/consent-forms'
import FormViewer from '@/components/portal/guardian/FormViewer'
import SignaturePad from '@/components/portal/guardian/SignaturePad'
import AutofillField from '@/components/portal/guardian/AutofillField'
import VerificationStep, { type VerificationResult } from '@/components/portal/guardian/VerificationStep'

export default function FormEditor({ childId, entry, isSample }: { childId: string; entry: FormListEntry; isSample: boolean }) {
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

  // hydrate saved (autofill) + any existing draft
  useEffect(() => {
    void fetch('/api/guardian/forms/saved-fields').then((r) => r.ok ? r.json() : null).then((s) => s && setSaved(s))
    void fetch(`/api/guardian/children/${childId}/forms/${schema.formId}/draft`).then((r) => r.ok ? r.json() : null).then((d) => {
      if (d && d.itemStates) { setItemStates((s) => ({ ...s, ...d.itemStates })); setFieldValues(d.fieldValues ?? {}); if (d.signature) setSignature(d.signature) }
    })
  }, [childId, schema.formId])

  // debounced draft autosave
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

  return (
    <div className="mx-auto max-w-5xl px-5 py-5 grid gap-5 md:grid-cols-[minmax(0,1fr)_360px]">
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
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "app/portal/parent/consent/[formId]"
git commit -m "feat(consent): guardian form editor (viewer + controls + submit)"
```

---

### Task 18: Consent index (replace the mock) + overview

**Files:**
- Modify: `app/portal/parent/consent/page.tsx`
- Rewrite: `app/portal/parent/consent/consent-client.tsx` → a forms index + live grants summary

- [ ] **Step 1: Rewrite `consent-client.tsx`** to a forms index (status chips, required badges, links to `/portal/parent/consent/[formId]`), keeping the existing grant cards (fed by `v.grants`) and `NominationCard` below. Show a final overview count (complete / total). Keep the existing grant Withdraw behavior wired to the revoke route.

```tsx
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
```

- [ ] **Step 2: Update `page.tsx`** to fetch forms and pass them; keep the sample notice + `NominationCard`s.

```tsx
import { getGuardianView } from '@/lib/portal/guardian/guardian-data'
import { getChildForms } from '@/lib/portal/guardian/consent-forms'
import NominationCard from '@/components/portal/guardian/NominationCard'
import ConsentClient from './consent-client'

export default async function GuardianConsentPage() {
  const v = await getGuardianView()
  const forms = await getChildForms(v.child.id)
  return (
    <div className="mx-auto max-w-3xl px-5 py-5 flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Consent for {v.child.displayName}</h1>
        <p className="text-muted text-[13px] mt-1">Read each form and record your choices. Each item is a separate, dated grant you can withdraw later.</p>
      </div>
      {v.isSample && <div className="text-[11px] font-mono text-muted border border-dashed border-black/15 rounded-md px-3 py-2">Sample data — sign in as a guardian to complete real forms.</div>}
      {v.nominations.map((n) => <NominationCard key={n.id} nomination={n} childName={v.child.displayName} />)}
      <ConsentClient forms={forms ?? []} />
    </div>
  )
}
```

- [ ] **Step 3: Typecheck + run the app**

Run: `npx tsc --noEmit -p tsconfig.json`
Then: `npm run dev` and open `/portal/parent/consent` — the forms index renders; clicking a form opens the editor with the PDF; drawing a signature + checking required items enables Submit.

- [ ] **Step 4: Commit**

```bash
git add app/portal/parent/consent/page.tsx app/portal/parent/consent/consent-client.tsx
git commit -m "feat(consent): replace consent mock with the real forms index"
```

---

## Phase 6 — Verification

### Task 19: Full test, typecheck, lint, build

- [ ] **Step 1: Run all package tests**

Run: `npm test`
Expected: all workspace tests pass (db, app, http). Investigate any failure before proceeding — do not claim success without the passing output.

- [ ] **Step 2: Run web tests**

Run: `npm run test:web`
Expected: the PDF-hash test passes.

- [ ] **Step 3: Typecheck every workspace + the web app**

Run: `npm run typecheck -w @curiolab/db -w @curiolab/app -w @curiolab/http && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: clean (fix any new warnings in the files you added).

- [ ] **Step 5: Production build**

Run: `npm run build`
Expected: build succeeds. (Per memory: a concurrent build on the shared branch can spuriously fail — a clean isolated build is the source of truth. If it fails on the pdf.js worker, apply the `public/`-hosted worker fallback from Task 14.)

- [ ] **Step 6: Final commit (if any lint/build fixups)**

```bash
git add -A
git commit -m "chore(consent): typecheck/lint/build fixups"
```

---

## Coverage map (spec → task)

- Display-only PDFs, one per Form 01–11 → Tasks 1, 2
- PDF content hash pinned + verified → Tasks 2, 3; bound at submit → Task 10 (`pdfSha256` check)
- Checkboxes parsed from `- [ ]`, each mapped to a clause → Task 4; overlay → Task 5
- Unchecked = explicit "no" → Task 10 (`itemStates` records every key), Task 17 (all keys initialized false)
- Required items block submit; optional don't → Task 10, Task 17
- Typed fill-in fields → Task 5 (fields), Task 17
- Signature capture (mouse/finger), stored → Task 15, Task 10 (`consent_signature`)
- Remembered values (typed + signature), one-tap suggested fill → Task 9 (getSavedFields), Task 16 (AutofillField), Task 15 (reuse), Task 10 (upsert)
- Per-form signature record bound to that form (id, version, PDF hash, item states, values, timestamp) → Task 7 (`consent_signature.binding`, `consent_form_completion`), Task 10
- Reused signature never silently satisfies an Elevated form → Task 10 (elevated gate), Task 16 (VerificationStep), backstopped by `captureGrant` (Task 10 wiring)
- Immutable completion audit, reconstructable → Task 6/7 (append-only tables), Task 10 (full item states + values + signature + hash + verification persisted). **Deferred:** the read-only `GET .../completions/:completionId` reconstruction endpoint/UI from spec Component 4 — the data is captured and reconstructable directly from the immutable tables; exposing it is a follow-up (no guardian-UI consumer in this build).
- Navigation: statuses, leave/resume, final overview → Task 9 (status), Task 17 (draft autosave/hydrate), Task 18 (index + overview)
- Elevated hook, swappable, stubbed → Task 16, Task 10
- Persistence scoped to guardian account, app store only → Tasks 7, 9, 10 (all guardian-account-keyed, no third-party surface)
- Drive the grant ledger → Task 10 (`captureGrant`, `evidence_artifact_ref = completionId`)
- Forms 08–11 catalogued, mounts deferred → Task 5 (catalog), index shows guardian-only (Task 18)
