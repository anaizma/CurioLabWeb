# Apply Funnel Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete apply-funnel frontend — Stage 1 lead form, 2A parent section, 2B student section, 2C review/submit — against the finished backend, plus the frontend-owned `POST /api/apply` route and a flow test.

**Architecture:** Four pages under `app/apply/**` calling the existing token-gated `/api/public/stage2/*` routes, one new thin route adapter (`app/api/apply/route.ts`) over `LeadService.createLead`, and a shared client module for questions/fields/API helpers/error copy. Server pages await async `params` (Next 16) and render client components. The flow test drives the real route handlers against the embedded-Postgres harness via `setSqlForTesting`.

**Tech Stack:** Next.js 16.2.10 (App Router, async params/cookies), React 19, TypeScript, `@curiolab/http` + `@curiolab/app` (workspace packages), Vitest + embedded Postgres.

**Supersedes:** `2026-07-22-application-funnel-stage-1.md` (the self-contained web-app lead model — obsolete; the backend now owns leads/stage2 end to end).

---

## Contract facts (verified against code — do not re-derive)

- `POST /api/apply` (frontend-owned): body `{ email, chapter, source?, fillerRole }` → `201 { leadId, suppressed, parentToken }`. `parentToken` is non-null ONLY for `fillerRole:"parent"` on a fresh (non-suppressed) lead. Ready-to-paste adapter is in `docs/platform/api-reference.md` §1.
- Stage-2 chain (all POST, all token-in-body, routes already exist): `start` (parent token → `201 {draftId, leadId}`, `409` if already started), `parent` (2A save, phase 2a), `student-link` (→ `{studentToken}`, re-mint supersedes), `student` (2B save, student token, allowlist-enforced), `review` (parent token, **phase 2c only — 409 otherwise**, → `{phase, status, parentAnswers, studentAnswers}`), `submit` (parent token only → `201 {applicationId, leadId}`), `send-back` (2c→2b).
- Error statuses (uniform from `packages/http/src/respond.ts`): `400` `{error:'invalid_request'}` bad/disallowed field; `401` `{error:'invalid_token'}`; `404` `{error:'not_found'}`; `409` `{error:'conflict'}` wrong phase/already started; `403` opaque.
- 2C `submit` requires 2A answers to contain non-empty strings under keys **`childName`, `guardianName`, `guardianEmail`** (camelCase, exactly these — `packages/app/src/stage2.ts:261`).
- 2B allowlist (`packages/app/src/config.ts:139` `STAGE2_STUDENT_ALLOWED_FIELDS`): `motivation, interests, project_idea, favorite_subject, prior_experience, availability, goals`. Any other key → 400; identifying-looking keys (name/email/school/…) → loud 400. **This plan uses only:** `interests, motivation, favorite_subject, project_idea, prior_experience, goals` (6 questions; the spec's "proud build" question is deferred pending an allowlist update — see "Open item" at the end).
- Chapter select sends a **slug**: `cwru` (Case Western Reserve University) or `another-school`. A lead whose slug matches no chapter row stays unmapped and cannot submit at 2C (`Stage2LeadChapterRequiredError` → 400) — correct behavior for "another school". **Production ops note:** a chapter row with slug `cwru` must exist (create via the admin API) for CWRU applications to submit.
- Next 16: route handlers export `POST(req: Request)` over Web APIs; **page `params` is a `Promise`** — `const { token } = await params` in a server component, pass to a `"use client"` child.
- Design system: match `app/signup/page.tsx` / `app/students/page.tsx` — container `mx-auto max-w-md px-6 py-20` (wide pages `max-w-2xl`), `label` class for field labels, inputs `w-full border border-black/20 rounded-md px-4 py-3 bg-white`, primary button `bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors`, muted text `text-muted`, headings `text-3xl md:text-4xl font-bold`. The 2B student page uses the `indigo` accent (`bg-indigo text-white`, `text-indigo` — already used by `app/careers/volunteer-mentor/page.tsx`) to feel like the student's own page.

## Guardrails

- **Do NOT touch `packages/*`** (any file), any existing `app/api/**` route, or the backend schema. The ONLY new route is `app/api/apply/route.ts`.
- **Read before coding** (AGENTS.md): `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` before Task 1; `03-layouts-and-pages.md` (async params) before Tasks 4–6.
- **Synthetic data only** in all tests and manual checks (obviously-fake names/emails).
- Stage the exact files listed per task; never `git add -A`.
- Friendly error copy only — never surface raw `{error:...}` bodies.

## File structure

**Create:**
- `app/api/apply/route.ts` — Stage-1 adapter (the one frontend-owned API route)
- `app/apply/funnel.ts` — shared: API helper, error copy, 2B questions, 2A field meta, sessionStorage keys
- `app/apply/page.tsx` — Stage 1 (client form)
- `app/apply/parent/[token]/page.tsx` — server wrapper (awaits params)
- `app/apply/parent/[token]/parent-client.tsx` — 2A client component (start/phase-router + form + student-link tool)
- `app/apply/student/[token]/page.tsx` — server wrapper
- `app/apply/student/[token]/student-client.tsx` — 2B client component
- `app/apply/review/[token]/page.tsx` — server wrapper
- `app/apply/review/[token]/review-client.tsx` — 2C client component
- `vitest.config.ts` + `test/apply-funnel-flow.test.ts` — the flow test
**Modify:** `app/page.tsx` (CTA), `app/students/page.tsx` (CTA), `package.json` (vitest devDep + `test:web` script), old plan file (superseded header).

---

### Task 1: `app/api/apply/route.ts`

**Files:** Create `app/api/apply/route.ts`

- [ ] **Step 1:** Read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`. Confirm `export async function POST(request: Request)` + `Response.json` (the pattern of `app/api/public/stage2/start/route.ts`).
- [ ] **Step 2:** Create the route — the api-reference §1 snippet plus input guards (per its note) and safe error mapping:

```ts
// POST /api/apply — Stage 1 lead capture (frontend-owned surface).
// Thin adapter: parse the body, call LeadService.createLead with the shared
// db client, return the created lead id as a uniform JSON Response.
// Contract: docs/platform/api-reference.md §1.
import { getSql } from '@curiolab/http'
import { LeadService } from '@curiolab/app'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const chapter = typeof body.chapter === 'string' ? body.chapter.trim() : ''
  const source = typeof body.source === 'string' && body.source.trim() ? body.source.trim() : null
  const fillerRole = body.fillerRole === 'student' ? ('student' as const) : ('parent' as const)

  // Input guards (the service does not validate presence; api-reference §1 note).
  if (!/.+@.+\..+/.test(email)) {
    return Response.json({ error: 'invalid_request', field: 'email' }, { status: 400 })
  }
  if (chapter === '') {
    return Response.json({ error: 'invalid_request', field: 'chapter' }, { status: 400 })
  }

  try {
    const result = await new LeadService({ sql: getSql() }).createLead({
      email,
      chapter,
      source,
      fillerRole,
    })
    // parentToken: raw Stage-2 token for a parent-filler (frontend builds the
    // continue link); null for a student-filler and for a suppressed duplicate.
    return Response.json(
      { leadId: result.leadId, suppressed: result.suppressed, parentToken: result.parentToken },
      { status: 201 },
    )
  } catch (err) {
    console.error('[api/apply]', err)
    return Response.json({ error: 'server_error' }, { status: 500 })
  }
}
```

- [ ] **Step 3:** `npx tsc --noEmit` → clean (workspace imports `@curiolab/http`/`@curiolab/app` must resolve; they do for the 90 existing routes).
- [ ] **Step 4:** Commit: `git add app/api/apply/route.ts && git commit -m "feat(apply): frontend-owned POST /api/apply lead adapter"`

### Task 2: `app/apply/funnel.ts` (shared client module)

**Files:** Create `app/apply/funnel.ts`

- [ ] **Step 1:** Create with exactly:

```ts
// Shared client-side plumbing for the apply funnel pages.
// The 2B question set MUST stay within the backend allowlist
// (packages/app/src/config.ts STAGE2_STUDENT_ALLOWED_FIELDS).

export interface ApiResult {
  status: number
  body: Record<string, unknown>
}

/** POST a JSON body; malformed/failed responses become a synthetic status. */
export async function postJson(path: string, payload: unknown): Promise<ApiResult> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return { status: res.status, body }
  } catch {
    return { status: 0, body: {} }
  }
}

/** Friendly copy per API status — never surface raw error bodies. */
export function errorCopy(status: number): string {
  switch (status) {
    case 400:
      return 'Something in the form needs another look — please check the fields and try again.'
    case 401:
      return 'This link is no longer valid — it may have expired or been replaced by a newer one.'
    case 409:
      return 'This step isn’t available right now — the application may have already moved forward.'
    case 403:
    case 404:
      return 'We couldn’t find that. Double-check your link.'
    default:
      return 'Something went wrong on our end. Please try again in a moment.'
  }
}

/** The 2B student questions. Keys MUST be on the backend allowlist. */
export const STUDENT_QUESTIONS: ReadonlyArray<{
  key: string
  label: string
  optional?: boolean
}> = [
  { key: 'interests', label: 'What do you like doing when you’re not in school?' },
  { key: 'motivation', label: 'Why do you want to join CurioLab?' },
  {
    key: 'favorite_subject',
    label: 'What’s something you’re curious about right now — in school or outside it?',
  },
  {
    key: 'project_idea',
    label:
      'Is there a problem you’ve noticed at school, in your neighborhood, or in your community that you wish someone would fix?',
  },
  {
    key: 'goals',
    label: 'What do you hope to learn or make by the end of your first semester?',
  },
  {
    key: 'prior_experience',
    label: 'Have you done any coding, building, or making before?',
    optional: true,
  },
]

/** Labels for the 2A facts, used by the 2C read-only review. */
export const PARENT_FIELD_LABELS: Readonly<Record<string, string>> = {
  childName: 'Student name',
  childDob: 'Date of birth',
  gradeEntering: 'Grade entering in the fall',
  schoolName: 'School',
  guardianName: 'Parent / guardian',
  guardianEmail: 'Guardian email',
  guardianPhone: 'Phone',
  relationship: 'Relationship to student',
  secondGuardianName: 'Second guardian',
  secondGuardianEmail: 'Second guardian email',
  saturdayAvailability: 'Saturday availability confirmed',
  commitmentAcknowledged: 'Commitment acknowledged',
  scholarshipInterest: 'Scholarship info requested',
  attestedGuardian: 'Attested parent/guardian',
  contactConsent: 'Consented to be contacted',
}

/** sessionStorage keys for smoothing the same-device flow (best-effort only). */
export const SS_LEAD_EMAIL = 'curiolab.apply.leadEmail'

export function studentLinkUrl(studentToken: string): string {
  return `${window.location.origin}/apply/student/${studentToken}`
}
```

- [ ] **Step 2:** `npx tsc --noEmit` → clean.
- [ ] **Step 3:** Commit: `git add app/apply/funnel.ts && git commit -m "feat(apply): shared funnel questions, labels, api helper"`

### Task 3: `/apply` — Stage 1

**Files:** Create `app/apply/page.tsx`

- [ ] **Step 1:** `"use client"` component styled like `app/signup/page.tsx`. State: `email`, `fillerRole` (`'parent'|'student'`, default parent, radio group), `chapter` (`''|'cwru'|'another-school'`, required select: "Case Western Reserve University (Cleveland, OH)" / "Interested in another school"), `source` (optional text), `status` (`idle|submitting|error`), plus a `result` state holding the success response.
- [ ] **Step 2:** On submit: `postJson('/api/apply', { email, chapter, source, fillerRole })`. On `201`: stash `sessionStorage.setItem(SS_LEAD_EMAIL, email)` (wrap in try/catch); set `result`. On error status: show `errorCopy(status)`.
- [ ] **Step 3:** Success rendering (replaces the form):
  - `fillerRole==='parent'` and `parentToken` non-null → heading "Check your email"; copy "We’ve sent you the application link. You can also continue right now."; primary `<Link href={`/apply/parent/${parentToken}`}>Continue to your application →</Link>` (coral button); note "The emailed link works too — both go to the same application."
  - `fillerRole==='student'` (parentToken null) → heading "We’ve emailed your parent"; copy "Ask them to look for a message from CurioLab, and to check the spam folder."
  - `suppressed===true` → "We already have a recent application started for this email — check your inbox for the link we sent."
- [ ] **Step 4:** Page copy: heading "Apply to CurioLab", intro "Grades 6–12. No experience required — just curiosity." Footer note: "We only ask for an email to start. We never collect anything about a student on this page."
- [ ] **Step 5:** `npx tsc --noEmit && npm run lint` → clean. Commit: `git add app/apply/page.tsx && git commit -m "feat(apply): Stage-1 lead form at /apply"`

### Task 4: `/apply/parent/[token]` — 2A

**Files:** Create `app/apply/parent/[token]/page.tsx`, `app/apply/parent/[token]/parent-client.tsx`

- [ ] **Step 1:** Read `node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md` (async `params`). Server wrapper:

```tsx
import ParentClient from './parent-client'

export default async function ParentTokenPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  return <ParentClient token={token} />
}
```

- [ ] **Step 2:** `parent-client.tsx` (`"use client"`). **Phase-router on mount** (there is no phase-read endpoint; `review` 409s before 2C — use try-and-branch):

```
POST stage2/start {token}
  201 → mode 'form' (fresh draft)
  409 → POST stage2/review {token}
          200 → router.replace(`/apply/review/${token}`)   // already at 2C
          409 → mode 'form' with alreadyStarted=true        // 2A or 2B
          401 → mode 'invalid'
  401 → mode 'invalid'
  other → mode 'error'
```

  In `alreadyStarted` mode show an info banner: "Welcome back. If you’ve already saved this section, re-saving may not be available — your student link tool is below."
- [ ] **Step 3:** The 2A form (fields saved as one `answers` object; keys exactly as in `PARENT_FIELD_LABELS`): child first + last name (two required inputs composed on save into `childName: \`${first} ${last}\``, plus stored as given), `childDob` (date input, required), `gradeEntering` (select 6–12, required), `schoolName` (required), guardian first + last (composed into `guardianName`, required), `guardianEmail` (email, required; prefill from `sessionStorage.getItem(SS_LEAD_EMAIL)` when present), `guardianPhone` (required), `relationship` (select: Parent / Legal guardian / Other, required), `secondGuardianName` + `secondGuardianEmail` (optional, with helper text "Password resets for a minor route to all verified guardians — a second contact avoids a stall"), checkboxes: `saturdayAvailability` (required), `commitmentAcknowledged` (required, label mentions Saturday sessions, semester fee, interview), `scholarshipInterest` (optional, "Would you like information about need-based scholarships?"), `attestedGuardian` (required, "I am the parent or legal guardian of this student"), `contactConsent` (required, "I consent to be contacted about this application"). Include a link to `/privacy` if the page exists, else plain text "See our privacy notice."
- [ ] **Step 4:** Save: `postJson('/api/public/stage2/parent', { token, answers })`. `200` → show the **student-link section**; `409` → friendly "This section is already locked in — your application has moved to the next step," still show the student-link section; other → `errorCopy`.
- [ ] **Step 5:** Student-link section: explainer "Your student fills in their own section, in their own words. Create a link and pass it to them however you like — we never ask for a student email."; button "Create a link to send to my student" → `postJson('/api/public/stage2/student-link', { token })` → display `studentLinkUrl(studentToken)` in a read-only input + Copy button (`navigator.clipboard.writeText`, fallback select-on-focus); note "Creating a new link replaces the old one."; after minting also show "When they’re done, come back here to review and submit." linking to `/apply/review/${token}`.
- [ ] **Step 6:** `npx tsc --noEmit && npm run lint` → clean. Commit both files: `git commit -m "feat(apply): 2A parent section with phase routing and student-link tool"`

### Task 5: `/apply/student/[token]` — 2B

**Files:** Create `app/apply/student/[token]/page.tsx` (same server-wrapper shape as Task 4 rendering `StudentClient`), `app/apply/student/[token]/student-client.tsx`

- [ ] **Step 1:** `"use client"`, second-person, **indigo accent**, container `max-w-2xl`. Heading "Your section"; intro copy (spec-mandated, keep the meaning): "This part is yours — your own words, filled in by you. A few sentences for each is plenty. There are no wrong answers, and nobody is grading this." Plus the plain-worded note: **"Your parent will read this before it is sent."**
- [ ] **Step 2:** Render one `<textarea>` per `STUDENT_QUESTIONS` entry (labels from the module; mark the optional one "Optional — any answer is fine, including none."). State: `answers: Record<string, string>`. **No identifying fields of any kind** (no name/email/school inputs — the backend rejects them loudly and it is the legal linchpin).
- [ ] **Step 3:** "Send back to my parent" button (indigo): build `answers` from non-empty entries only, `postJson('/api/public/stage2/student', { token, answers })`. `200` → done screen: "Sent! Your parent will review this before it goes to CurioLab. You can close this page." `401` → "This link isn’t valid anymore — ask your parent to create a new one." `409` → "This section isn’t open right now — ask your parent to check the application." `400` → `errorCopy(400)`.
- [ ] **Step 4:** `npx tsc --noEmit && npm run lint` → clean. Commit: `git commit -m "feat(apply): 2B student section in the student's voice"`

### Task 6: `/apply/review/[token]` — 2C

**Files:** Create `app/apply/review/[token]/page.tsx` (server wrapper rendering `ReviewClient`), `app/apply/review/[token]/review-client.tsx`

- [ ] **Step 1:** On mount `postJson('/api/public/stage2/review', { token })`: `200` → render; `409` → "not ready" screen ("Your application isn’t at the review step yet. If your student is still writing, check back after they finish." + link to `/apply/parent/${token}`); `401` → invalid-link screen; other → `errorCopy`.
- [ ] **Step 2:** Render read-only: "About your student" — each `parentAnswers` entry that has a `PARENT_FIELD_LABELS` label (booleans as Yes/No); "Your student’s own words" — for each `STUDENT_QUESTIONS` entry present in `studentAnswers`, the question label + answer text (preserve line breaks with `whitespace-pre-wrap`). **No edit controls on student answers.**
- [ ] **Step 3:** Actions: primary "Submit application" → `postJson('/api/public/stage2/submit', { token })` → `201` → confirmation screen ("Application submitted. A Chapter Director will be in touch about the interview. We’ve got it from here."); `400` → "The parent section is missing required details (student name, guardian name, guardian email)" with a link back to `/apply/parent/${token}` (also covers the unmapped-chapter 400 with generic copy); `409/401` → friendly copy. Secondary "Send back to my student" (bordered button) with an optional note explainer ("They’ll be able to edit their section again; you’ll review the new version before anything is sent") → `postJson('/api/public/stage2/send-back', { token })` → `200` → screen "Sent back. Create a fresh student link if they need one." linking to `/apply/parent/${token}`.
- [ ] **Step 4:** `npx tsc --noEmit && npm run lint` → clean. Commit: `git commit -m "feat(apply): 2C parent review, send-back, and submit"`

### Task 7: CTA rewiring

**Files:** Modify `app/page.tsx`, `app/students/page.tsx`

- [ ] **Step 1:** `app/page.tsx` final-CTA `<Link href="/students" ...>Start an application →</Link>` → `href="/apply"`. Check for any other "apply" CTAs on the homepage and point them at `/apply` too.
- [ ] **Step 2:** `app/students/page.tsx`: replace the `mailto:aizma@curiolab.org` anchor (`Application →`) with `<a href="/apply" className="(same classes)">Apply →</a>`.
- [ ] **Step 3:** `npm run lint` → clean. Commit both: `git commit -m "feat(apply): point apply CTAs at /apply"`

### Task 8: Flow test

**Files:** Create `vitest.config.ts`, `test/apply-funnel-flow.test.ts`; Modify `package.json`

- [ ] **Step 1:** `package.json`: add `"vitest": "^2.1.9"` to devDependencies and `"test:web": "vitest run"` to scripts (leave `"test"` untouched). `npm install`.
- [ ] **Step 2:** `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 240_000,
  },
})
```

- [ ] **Step 3:** `test/apply-funnel-flow.test.ts` — drives the REAL route handlers (my `/api/apply` + the six stage2 routes) against embedded Postgres via `setSqlForTesting`, reusing the http harness helpers by relative import:

```ts
// The full apply-funnel walk over the REAL Next route handlers, embedded
// Postgres, synthetic data only. Stage 1 (/api/apply) is frontend-owned and is
// exercised here (packages/http/test/public-funnel.test.ts covers the
// controllers but deliberately not this route).
import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { setSqlForTesting } from '@curiolab/http'
import { startHarness, type Harness } from '../packages/http/test/helpers/pg.js'
import { POST as apply } from '../app/api/apply/route'
import { POST as start } from '../app/api/public/stage2/start/route'
import { POST as parent } from '../app/api/public/stage2/parent/route'
import { POST as studentLink } from '../app/api/public/stage2/student-link/route'
import { POST as student } from '../app/api/public/stage2/student/route'
import { POST as review } from '../app/api/public/stage2/review/route'
import { POST as submit } from '../app/api/public/stage2/submit/route'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
  setSqlForTesting(h.sql)
}, 240_000)

afterAll(async () => {
  setSqlForTesting(null)
  await h?.end()
})

function req(payload: unknown): Request {
  return new Request('http://test.local/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

describe('the apply funnel, end to end over the route handlers', () => {
  test('parent walk: apply -> start -> 2A -> link -> 2B -> review -> submit', async () => {
    // A chapter the lead's slug maps to (submit requires the mapping).
    const slug = `cwru-test-${Date.now()}`
    await h.sql`insert into chapter (name, slug) values ('CWRU Test', ${slug})`

    // Stage 1 — parent filler gets the raw parent token back.
    const applyRes = await apply(
      req({ email: 'pat.tester@example.test', chapter: slug, source: 'flow-test', fillerRole: 'parent' }),
    )
    expect(applyRes.status).toBe(201)
    const applyBody = await json(applyRes)
    expect(applyBody.suppressed).toBe(false)
    const parentToken = applyBody.parentToken as string
    expect(typeof parentToken).toBe('string')

    // start consumes the lead token and creates the draft.
    expect((await start(req({ token: parentToken }))).status).toBe(201)

    // 2A parent facts (childName/guardianName/guardianEmail are required at submit).
    const parentSave = await parent(
      req({
        token: parentToken,
        answers: {
          childName: 'Testy Example', childDob: '2013-01-01', gradeEntering: '7',
          schoolName: 'Example Middle School', guardianName: 'Pat Tester',
          guardianEmail: 'pat.tester@example.test', guardianPhone: '555-0100',
          relationship: 'Parent', saturdayAvailability: true,
          commitmentAcknowledged: true, attestedGuardian: true, contactConsent: true,
        },
      }),
    )
    expect(parentSave.status).toBe(200)

    // Mint the 2B link; the student saves NON-IDENTIFYING answers only.
    const linkRes = await studentLink(req({ token: parentToken }))
    expect(linkRes.status).toBe(200)
    const studentToken = (await json(linkRes)).studentToken as string

    const studentSave = await student(
      req({ token: studentToken, answers: { interests: 'building model rockets', motivation: 'i want to make things', goals: 'finish a real project' } }),
    )
    expect(studentSave.status).toBe(200)

    // 2C: review shows both sections read-only; submit mints the application.
    const reviewRes = await review(req({ token: parentToken }))
    expect(reviewRes.status).toBe(200)
    const reviewBody = await json(reviewRes)
    expect((reviewBody.parentAnswers as Record<string, unknown>).childName).toBe('Testy Example')
    expect((reviewBody.studentAnswers as Record<string, unknown>).interests).toBe('building model rockets')

    const submitRes = await submit(req({ token: parentToken }))
    expect(submitRes.status).toBe(201)
    const submitBody = await json(submitRes)
    const apps = await h.sql`select id, status from application where id = ${submitBody.applicationId as string}`
    expect(apps).toHaveLength(1)
    expect(apps[0]!.status).toBe('submitted')
  })

  test('a student filler gets NO token back', async () => {
    const res = await apply(
      req({ email: 'other.parent@example.test', chapter: 'another-school', fillerRole: 'student' }),
    )
    expect(res.status).toBe(201)
    expect((await json(res)).parentToken).toBeNull()
  })

  test('the student token cannot submit and identifying 2B fields are rejected', async () => {
    const slug = `cwru-t2-${Date.now()}`
    await h.sql`insert into chapter (name, slug) values ('CWRU T2', ${slug})`
    const applyBody = await json(
      await apply(req({ email: 'second.tester@example.test', chapter: slug, fillerRole: 'parent' })),
    )
    const parentToken = applyBody.parentToken as string
    await start(req({ token: parentToken }))
    await parent(req({ token: parentToken, answers: { childName: 'Kid Example', guardianName: 'Sam Tester', guardianEmail: 'second.tester@example.test' } }))
    const studentToken = (await json(await studentLink(req({ token: parentToken })))).studentToken as string

    // Identifying key -> loud 400.
    expect((await student(req({ token: studentToken, answers: { childSchool: 'Real Name Middle' } }))).status).toBe(400)
    // Student token against a parent-token endpoint -> 401 (opaque).
    expect((await submit(req({ token: studentToken }))).status).toBe(401)
    // Bad token -> 401, never a 500.
    expect((await start(req({ token: 'not-a-real-token' }))).status).toBe(401)
  })
})
```

  Note: if `chapter` has NOT-NULL columns beyond `(name, slug)` (check `packages/db/src/schema.ts` — read-only!), use `makeChapter` from `../packages/http/test/helpers/fixtures.js` instead of the raw insert, and update the lead's `chapter` slug to the fixture's slug via `update application_lead set ...`? No — simpler: read `makeChapter`'s definition and replicate a valid insert **with a known slug**; if `makeChapter` accepts a slug parameter, just use it.
- [ ] **Step 4:** `npm run test:web` → all 3 tests PASS (first run downloads embedded Postgres).
- [ ] **Step 5:** Commit: `git add package.json package-lock.json vitest.config.ts test/apply-funnel-flow.test.ts && git commit -m "test(apply): end-to-end funnel walk over the real route handlers"`

### Task 9: Supersede the old plan + verification

**Files:** Modify `docs/superpowers/plans/2026-07-22-application-funnel-stage-1.md` (header note only)

- [ ] **Step 1:** Add directly under the old plan's title: `> **SUPERSEDED** by [2026-07-23-apply-funnel-frontend.md](2026-07-23-apply-funnel-frontend.md) — the backend now owns leads/stage2; Tasks 4–15 here were never executed and must not be.` Commit.
- [ ] **Step 2:** `npx tsc --noEmit && npm run lint && npm run build` → clean; `/apply`, `/apply/parent/[token]`, `/apply/student/[token]`, `/apply/review/[token]`, `/api/apply` all appear in the build output.
- [ ] **Step 3:** `git status --short packages/` → nothing staged/modified by this work (the pre-existing `lead.ts`/`lead.test.ts` working-tree changes are the backend's token fix — leave them exactly as they are).
- [ ] **Step 4:** Manual walk with the run skill (`npm run dev`, no DATABASE_URL → /api/apply will 500 on DB; for a full local walk set DATABASE_URL to a dev database with the migrations applied, or rely on the flow test): verify the four pages render, the Stage-1 form validates, CTAs land on `/apply`.

---

## Open item (for the user, non-blocking)

The spec's student question "Have you ever built, made, or fixed something you were proud of?" has no honest key on the current backend allowlist (and `availability` goes unused by the form). Proposed allowlist edit (config value, `packages/app/src/config.ts`): replace `favorite_subject, project_idea, availability` with `curiosity, proud_build, problem_to_fix` — then the form gains the 7th question and two keys get semantically honest names. One small edit to `STUDENT_QUESTIONS` on the frontend when that lands.
