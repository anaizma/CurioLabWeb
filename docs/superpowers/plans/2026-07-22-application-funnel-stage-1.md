# Application Funnel — Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working Stage-1 application funnel on the website — a `/apply` form that records a parent-email-only lead, sends a receipt + staff notification, and deletes unconverted leads after 30 days — without touching the backend agent's live packages.

**Architecture:** Fully self-contained in the Next.js web app. A `LeadStore` interface with an in-memory store (dev/test) and a `postgres` adapter (prod) sits under a small pure `createLead`/`sweepExpiredLeads` service. A thin `handleApply` core does validation + dedup and is unit-tested without Next or Resend; the route handler wraps it and sends email. The `submitApplication` rework and the move into `packages/*` are **recorded** in a coordination plan for the backend agent, not done here.

**Tech Stack:** Next.js 16.2.10 (App Router, route handlers), React 19, TypeScript, `postgres` (npm), Resend, Vitest.

---

## Execution prerequisites & guardrails

- **Do NOT edit `packages/app`, `packages/db`, or `packages/core`.** They are the backend agent's live, uncommitted work. This plan is self-contained in `app/`, `lib/`, `db/`, and `docs/`. No git worktree is needed.
- **Read the Next.js docs before writing any Next.js code**, per [AGENTS.md](../../../AGENTS.md): this repo pins `next@16.2.10` and its APIs may differ from training data. Specifically read the route-handler and App-Router docs under `node_modules/next/dist/docs/` (search for `route` and `app`) before Tasks 12–13.
- **Import style:** the web app uses extensionless imports (e.g. `import X from "@/components/X"`). Use extensionless relative imports in `lib/` (`./types`, not `./types.js`). The `@/*` alias maps to the repo root (verify in Task 4).
- **Commit after each task.** Commit only the files that task creates/modifies. Never `git add -A` (it would stage the other agent's untracked work).

---

## File structure

**Create:**
- `docs/platform/plans/milestone-1-application-funnel.md` — coordination plan (the "second dot")
- `db/application_lead.sql` — web-app-owned lead table DDL
- `lib/leads/types.ts` — `Lead`, `LeadInput`, `LeadStore`, result types
- `lib/leads/service.ts` — `createLead`, `sweepExpiredLeads`, token/expiry constants
- `lib/leads/memory-store.ts` — in-memory `LeadStore` (dev/test)
- `lib/leads/postgres-store.ts` — `postgres` `LeadStore` adapter
- `lib/leads/index.ts` — `getLeadStore()` factory + re-exports
- `lib/apply-handler.ts` — pure validation + dedup core (`handleApply`)
- `lib/emails/apply.ts` — `buildParentReceipt`, `buildStaffNotification`
- `app/api/apply/route.ts` — the `POST /api/apply` handler
- `app/apply/page.tsx` — the Stage-1 form
- `vitest.config.ts` — web-app test config
- Tests: `lib/leads/service.test.ts`, `lib/apply-handler.test.ts`, `lib/emails/apply.test.ts`

**Modify:**
- `docs/platform/08-build-phasing.md` — build-vs-production reframing
- `docs/platform/open-questions.md` — build-vs-production note + two resolved items
- `package.json` — add `postgres` dep, `vitest` dev-dep, `test:web` script
- `app/page.tsx:208` — CTA → `/apply`
- `app/students/page.tsx:20` — CTA → `/apply`

---

## Task 1: Reframe 08-build-phasing.md (build vs. production)

**Files:** Modify `docs/platform/08-build-phasing.md`

- [ ] **Step 1: Insert a new subsection after the schedule-ruling section.** Find the line that ends the "## The schedule ruling: fall 2026 runs on paper" section (the paragraph ending "…a rushed intake system holding real families is worse than no system. Two consequences are designed now, not later…"). Immediately **before** the `## Milestone 0: The floor` heading, insert:

```markdown
## Buildable now versus live with real data

The legal review gates **real families' data reaching production, not the code**. All of
Milestone 1 is buildable and testable now against synthetic data (the embedded-Postgres
harness), and should be, so it is ready the day the review clears. What the gate forbids is a
real child's data flowing through an un-reviewed path in production.

Two consequences for the application funnel:

- **Stage 1 lead capture has no gate at all.** It collects a parent or guardian email and
  nothing about a child, so it is outside COPPA's minor-data surface — the same category as the
  public site. It ships during the paper period as live interest capture, and its
  unconverted-lead deletion is the § 312.4(c)(1)(vii) job from
  [compliance-coppa.md](compliance-coppa.md) 1.5 / Part 3.
- **Stages 2 and 3 are built and tested against synthetic data**, but do not collect a real
  family's data in production until the review clears. The public write now creates an
  `application_lead` (parent email only), superseding the earlier single-row `application` that
  collected a child's name at the public endpoint. See
  [plans/milestone-1-application-funnel.md](plans/milestone-1-application-funnel.md).
```

- [ ] **Step 2: Verify the edit reads correctly in context.**

Run: `sed -n '/## Buildable now versus live/,/## Milestone 0/p' docs/platform/08-build-phasing.md`
Expected: the new subsection prints, immediately followed by the `## Milestone 0` heading.

- [ ] **Step 3: Commit.**

```bash
git add docs/platform/08-build-phasing.md
git commit -m "docs(phasing): distinguish buildable-now from live-with-real-data"
```

---

## Task 2: Reflect COPPA findings in open-questions.md

**Files:** Modify `docs/platform/open-questions.md`

- [ ] **Step 1: Add the build-vs-production note.** Find the line (near the top, under `# Open questions register`):

```
Each item names its owner and what it blocks. Legal items gate Milestone 1 going live with real data (see [08-build-phasing.md](08-build-phasing.md)).
```

Replace it with:

```
Each item names its owner and what it blocks. Legal items gate Milestone 1 going live with real data (see [08-build-phasing.md](08-build-phasing.md)). They do **not** gate building or testing Milestone 1 against synthetic data — the funnel and its flows are built now and exercised on synthetic fixtures; only real-family data in production waits on the review.
```

- [ ] **Step 2: Add two resolved build items.** Find the `## Resolved by the COPPA analysis (see [compliance-coppa.md](compliance-coppa.md))` heading and add these two bullets to the end of that section's list:

```markdown
- **The application funnel supersedes the single-row application model.** The public write creates an `application_lead` (parent email only, no child data). Child facts and the student's own section are collected in Stage 2 and submitted by the parent at 2C. See [plans/milestone-1-application-funnel.md](plans/milestone-1-application-funnel.md).
- **The § 312.4(c)(1)(vii) delete-if-no-consent job is the 30-day `application_lead` expiry.** Unconverted leads (no submitted application) are swept 30 days after collection.
```

- [ ] **Step 3: Verify.**

Run: `grep -n "supersedes the single-row\|do \*\*not\*\* gate building" docs/platform/open-questions.md`
Expected: both lines are found.

- [ ] **Step 4: Commit.**

```bash
git add docs/platform/open-questions.md
git commit -m "docs(open-questions): record funnel supersession and the 30-day lead-deletion job"
```

---

## Task 3: Write the coordination plan (the "second dot")

**Files:** Create `docs/platform/plans/milestone-1-application-funnel.md`

- [ ] **Step 1: Create the file** with exactly this content:

```markdown
# Milestone 1 — Application funnel: coordination plan

Status: living. Stage-1 owner (this doc): the web/frontend agent. Platform backend
(`packages/*`) owner: the backend agent.

This is the shared record so the two efforts connect cleanly. Read it before touching the
application funnel from either side.

## Why this exists

The application funnel reshapes intake into stages: Stage 1 collects only a parent email (no
child data); Stage 2 (2A parent / 2B student / 2C parent-submit) collects the rest under one
token and submits as a parent action; Stage 3 is post-acceptance consent. Design spec:
[../../superpowers/specs/2026-07-22-application-funnel-stage-1-design.md](../../superpowers/specs/2026-07-22-application-funnel-stage-1-design.md).

## Division of work

### Built now, by the web agent (Stage 1, self-contained)

To avoid colliding with the backend agent's live, uncommitted work in `packages/app` and
`packages/db`, Stage 1 is deliberately self-contained in the web app and touches no package:

- `app/apply/page.tsx` — the Stage-1 form (parent email, filler role, chapter, source).
- `app/api/apply/route.ts` — the public write; calls the lead service, sends emails.
- `lib/leads/*` — a small lead service (`createLead`, `sweepExpiredLeads`) over a `LeadStore`
  interface, with an in-memory store for dev/test and a `postgres` adapter for production.
- `db/application_lead.sql` — the `application_lead` table DDL (web-app-owned for now).
- Emails via Resend: a parent receipt (no live link yet) and a staff notification.

### The Phase-2 handoff (backend agent owns, when convenient)

When the backend agent restructures `application` for the funnel, fold Stage 1 in:

1. **Move the lead model into `packages/db`**: an `application_lead` table (columns as in
   `db/application_lead.sql`), replacing the web-app-owned copy — a Drizzle def + a migration
   (`0005_application_lead.sql` or the next free number).
2. **Move lead logic into `packages/app`**: `LeadService.createLead` / `sweepExpiredLeads`
   mirroring `lib/leads/service.ts`, gated the same inert way as the current public write.
3. **Supersede `submitApplication`**: the public write creates a *lead*, not an `application`
   row with a child's name. `application.applicant_name` / `applicant_contact_email` (currently
   NOT NULL) move off the public path; child facts arrive at 2A and the row is created at 2C.
4. **Repoint the web route** `app/api/apply/route.ts` from `lib/leads` to `@curiolab/app`.
5. **Retire** `db/application_lead.sql` and `lib/leads/*` once the above lands.

### The token / 2A–2B–2C contract (for Phase 2)

- One token per application, shared by 2A/2B/2C with a section parameter; 30-day expiry at
  request time; partial answers persist against the token; consumed at 2C submit.
- `application_lead.token_hash` issued at Stage 1 is the seed; `converted_at` is set when 2C
  creates the `application`.
- No student email is ever collected; the 2B link is delivered to the parent.

## Retention job

`sweepExpiredLeads` deletes unconverted leads past `expires_at` (30 days) — the
§ 312.4(c)(1)(vii) delete-if-no-consent obligation. Wire it to the platform's pg-boss worker at
go-live; until then it is invokable directly.

## Go-live dependencies (not provisioned here)

- A provisioned Postgres (`DATABASE_URL`) with `db/application_lead.sql` applied.
- The transactional email subdomain with SPF/DKIM/DMARC (currently the Resend sandbox sender).
- The pg-boss schedule for `sweepExpiredLeads`.
```

- [ ] **Step 2: Commit.**

```bash
git add docs/platform/plans/milestone-1-application-funnel.md
git commit -m "docs(plans): add Milestone-1 application-funnel coordination plan"
```

---

## Task 4: Test tooling and dependencies

**Files:** Modify `package.json`; Create `vitest.config.ts`

- [ ] **Step 1: Verify the `@/*` path alias exists.**

Run: `grep -n "paths\|@/\*" tsconfig.json`
Expected: a `"@/*": ["./*"]` mapping. If it is missing, add `"paths": { "@/*": ["./*"] }` under `compilerOptions` in `tsconfig.json` and commit that with this task.

- [ ] **Step 2: Add dependencies and a test script to `package.json`.** Add `"postgres": "^3.4.5"` to `dependencies`, `"vitest": "^2.1.9"` to `devDependencies`, and `"test:web": "vitest run"` to `scripts`. Do **not** change the existing `"test"` script. Then install:

Run: `npm install`
Expected: `postgres` and `vitest` resolve and `package-lock.json` updates.

- [ ] **Step 3: Create `vitest.config.ts`:**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 4: Verify the runner starts (no tests yet is fine).**

Run: `npm run test:web`
Expected: Vitest runs and reports "No test files found" (or exits 0). If it errors on config, fix before proceeding.

- [ ] **Step 5: Commit.**

```bash
git add package.json package-lock.json vitest.config.ts tsconfig.json
git commit -m "chore(web): add vitest + postgres for Stage-1 lead capture"
```

---

## Task 5: Lead types and the LeadStore interface

**Files:** Create `lib/leads/types.ts`

- [ ] **Step 1: Create `lib/leads/types.ts`:**

```ts
export type FillerRole = 'parent' | 'student'

/** What the Stage-1 form submits. No child data — parent email only. */
export interface LeadInput {
  email: string
  chapter: string
  source?: string | null
  fillerRole: FillerRole
}

/** A stored application lead. */
export interface Lead {
  id: string
  email: string
  chapter: string
  source: string | null
  fillerRole: FillerRole
  tokenHash: string
  createdAt: Date
  expiresAt: Date
  convertedAt: Date | null
}

export interface CreateLeadResult {
  leadId: string
  /** True when an in-window duplicate suppressed the write; no new row created. */
  suppressed: boolean
}

/** Persistence seam: an in-memory impl for dev/test, a postgres impl for prod. */
export interface LeadStore {
  findRecentByEmail(email: string, since: Date): Promise<Lead | null>
  insert(lead: Lead): Promise<void>
  /** Deletes unconverted leads with expires_at < now. Returns the count deleted. */
  deleteExpired(now: Date): Promise<number>
}
```

- [ ] **Step 2: Typecheck.**

Run: `npx tsc --noEmit`
Expected: no errors from `lib/leads/types.ts`.

- [ ] **Step 3: Commit.**

```bash
git add lib/leads/types.ts
git commit -m "feat(leads): lead types and the LeadStore interface"
```

---

## Task 6: The in-memory store and `createLead` (TDD)

**Files:** Create `lib/leads/memory-store.ts`, `lib/leads/service.ts`, `lib/leads/service.test.ts`

- [ ] **Step 1: Write the in-memory store** `lib/leads/memory-store.ts` (needed by the tests):

```ts
import type { Lead, LeadStore } from './types'

export class MemoryLeadStore implements LeadStore {
  readonly leads: Lead[] = []

  async findRecentByEmail(email: string, since: Date): Promise<Lead | null> {
    const matches = this.leads
      .filter((l) => l.email === email && l.createdAt >= since)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    return matches[0] ?? null
  }

  async insert(lead: Lead): Promise<void> {
    this.leads.push(lead)
  }

  async deleteExpired(now: Date): Promise<number> {
    const before = this.leads.length
    for (let i = this.leads.length - 1; i >= 0; i--) {
      const l = this.leads[i]!
      if (l.convertedAt === null && l.expiresAt < now) this.leads.splice(i, 1)
    }
    return before - this.leads.length
  }
}
```

- [ ] **Step 2: Write the failing test** `lib/leads/service.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createLead, sweepExpiredLeads, DEDUPE_WINDOW_MS, LEAD_TTL_MS } from './service'
import { MemoryLeadStore } from './memory-store'

const base = new Date('2026-07-22T12:00:00Z')
const at = (ms: number) => () => new Date(base.getTime() + ms)

describe('createLead', () => {
  it('creates one lead with a hashed token and a +30d expiry', async () => {
    const store = new MemoryLeadStore()
    const r = await createLead(
      { email: 'Parent@Example.com', chapter: 'cwru', fillerRole: 'parent' },
      { store, now: () => base },
    )
    expect(r.suppressed).toBe(false)
    expect(store.leads).toHaveLength(1)
    const lead = store.leads[0]!
    expect(lead.email).toBe('parent@example.com') // normalized
    expect(lead.tokenHash).toMatch(/^[0-9a-f]{64}$/) // sha-256 hex
    expect(lead.expiresAt.getTime()).toBe(base.getTime() + LEAD_TTL_MS)
    expect(lead.convertedAt).toBeNull()
  })

  it('suppresses a duplicate email within the dedupe window', async () => {
    const store = new MemoryLeadStore()
    const first = await createLead(
      { email: 'p@example.com', chapter: 'cwru', fillerRole: 'parent' },
      { store, now: () => base },
    )
    const second = await createLead(
      { email: 'p@example.com', chapter: 'cwru', fillerRole: 'parent' },
      { store, now: at(DEDUPE_WINDOW_MS - 1000) },
    )
    expect(second.suppressed).toBe(true)
    expect(second.leadId).toBe(first.leadId)
    expect(store.leads).toHaveLength(1)
  })

  it('does not suppress the same email after the window', async () => {
    const store = new MemoryLeadStore()
    await createLead({ email: 'p@example.com', chapter: 'cwru', fillerRole: 'parent' }, { store, now: () => base })
    const second = await createLead(
      { email: 'p@example.com', chapter: 'cwru', fillerRole: 'parent' },
      { store, now: at(DEDUPE_WINDOW_MS + 1000) },
    )
    expect(second.suppressed).toBe(false)
    expect(store.leads).toHaveLength(2)
  })

  it('does not suppress a different email', async () => {
    const store = new MemoryLeadStore()
    await createLead({ email: 'a@example.com', chapter: 'cwru', fillerRole: 'parent' }, { store, now: () => base })
    const second = await createLead(
      { email: 'b@example.com', chapter: 'cwru', fillerRole: 'parent' },
      { store, now: () => base },
    )
    expect(second.suppressed).toBe(false)
    expect(store.leads).toHaveLength(2)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails.**

Run: `npm run test:web -- lib/leads/service.test.ts`
Expected: FAIL — `createLead` / `service` module not found.

- [ ] **Step 4: Implement** `lib/leads/service.ts`:

```ts
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import type { CreateLeadResult, Lead, LeadInput, LeadStore } from './types'

export const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours
export const LEAD_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

/** Random token; only its sha-256 hash is stored. Raw token is not emailed yet (Phase 2). */
export function issueToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  return { token, tokenHash }
}

export interface CreateLeadDeps {
  store: LeadStore
  now?: () => Date
  dedupeWindowMs?: number
  ttlMs?: number
}

export async function createLead(input: LeadInput, deps: CreateLeadDeps): Promise<CreateLeadResult> {
  const now = deps.now?.() ?? new Date()
  const dedupeWindowMs = deps.dedupeWindowMs ?? DEDUPE_WINDOW_MS
  const ttlMs = deps.ttlMs ?? LEAD_TTL_MS
  const email = input.email.trim().toLowerCase()

  const cutoff = new Date(now.getTime() - dedupeWindowMs)
  const existing = await deps.store.findRecentByEmail(email, cutoff)
  if (existing) return { leadId: existing.id, suppressed: true }

  const { tokenHash } = issueToken()
  const lead: Lead = {
    id: randomUUID(),
    email,
    chapter: input.chapter,
    source: input.source?.trim() || null,
    fillerRole: input.fillerRole,
    tokenHash,
    createdAt: now,
    expiresAt: new Date(now.getTime() + ttlMs),
    convertedAt: null,
  }
  await deps.store.insert(lead)
  return { leadId: lead.id, suppressed: false }
}

export interface SweepDeps {
  store: LeadStore
  now?: () => Date
}

/** § 312.4(c)(1)(vii): delete unconverted leads past their 30-day expiry. */
export async function sweepExpiredLeads(deps: SweepDeps): Promise<number> {
  const now = deps.now?.() ?? new Date()
  return deps.store.deleteExpired(now)
}
```

- [ ] **Step 5: Run the test to verify it passes** (the `sweepExpiredLeads` test is added in Task 7; `createLead` tests must pass now).

Run: `npm run test:web -- lib/leads/service.test.ts`
Expected: the four `createLead` tests PASS.

- [ ] **Step 6: Commit.**

```bash
git add lib/leads/memory-store.ts lib/leads/service.ts lib/leads/service.test.ts
git commit -m "feat(leads): createLead with dedup, hashed token, 30d expiry"
```

---

## Task 7: `sweepExpiredLeads` (TDD)

**Files:** Modify `lib/leads/service.test.ts` (append a describe block)

- [ ] **Step 1: Append the failing test** to `lib/leads/service.test.ts`:

```ts
describe('sweepExpiredLeads', () => {
  it('deletes only unconverted leads past expiry', async () => {
    const store = new MemoryLeadStore()
    await createLead({ email: 'converted@example.com', chapter: 'cwru', fillerRole: 'parent' }, { store, now: () => base })
    await createLead({ email: 'expired@example.com', chapter: 'cwru', fillerRole: 'parent' }, { store, now: () => base })
    // Mark the first as converted; both are past expiry at the sweep time.
    store.leads[0]!.convertedAt = new Date(base.getTime() + 1000)

    const deleted = await sweepExpiredLeads({ store, now: at(LEAD_TTL_MS + 1000) })

    expect(deleted).toBe(1) // only the unconverted, expired one
    expect(store.leads.map((l) => l.email)).toEqual(['converted@example.com'])
  })

  it('keeps leads that have not yet expired', async () => {
    const store = new MemoryLeadStore()
    await createLead({ email: 'fresh@example.com', chapter: 'cwru', fillerRole: 'parent' }, { store, now: () => base })
    const deleted = await sweepExpiredLeads({ store, now: at(LEAD_TTL_MS - 1000) })
    expect(deleted).toBe(0)
    expect(store.leads).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify it passes** (the implementation from Task 6 already satisfies it — this test pins the behavior).

Run: `npm run test:web -- lib/leads/service.test.ts`
Expected: all `createLead` and `sweepExpiredLeads` tests PASS.

- [ ] **Step 3: Commit.**

```bash
git add lib/leads/service.test.ts
git commit -m "test(leads): pin sweepExpiredLeads retention behavior"
```

---

## Task 8: Postgres store adapter + table DDL

**Files:** Create `db/application_lead.sql`, `lib/leads/postgres-store.ts`

- [ ] **Step 1: Create the table DDL** `db/application_lead.sql`:

```sql
-- Web-app-owned Stage-1 lead table. Intentionally standalone from packages/db
-- (see docs/platform/plans/milestone-1-application-funnel.md); folds into
-- packages/db when the funnel backend is built. No child data lives here.
create table if not exists application_lead (
  id           uuid primary key,
  email        text not null,
  chapter      text not null,
  source       text,
  filler_role  text not null check (filler_role in ('parent', 'student')),
  token_hash   text not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  converted_at timestamptz
);

create index if not exists application_lead_email_created_idx
  on application_lead (email, created_at desc);

create index if not exists application_lead_expiry_idx
  on application_lead (expires_at) where converted_at is null;
```

- [ ] **Step 2: Create the adapter** `lib/leads/postgres-store.ts`:

```ts
import type { Sql } from 'postgres'
import type { Lead, LeadStore } from './types'

function mapRow(row: Record<string, unknown>): Lead {
  return {
    id: row.id as string,
    email: row.email as string,
    chapter: row.chapter as string,
    source: (row.source as string | null) ?? null,
    fillerRole: row.filler_role as Lead['fillerRole'],
    tokenHash: row.token_hash as string,
    createdAt: row.created_at as Date,
    expiresAt: row.expires_at as Date,
    convertedAt: (row.converted_at as Date | null) ?? null,
  }
}

export class PostgresLeadStore implements LeadStore {
  constructor(private readonly sql: Sql) {}

  async findRecentByEmail(email: string, since: Date): Promise<Lead | null> {
    const rows = await this.sql`
      select * from application_lead
      where email = ${email} and created_at >= ${since}
      order by created_at desc
      limit 1
    `
    return rows[0] ? mapRow(rows[0] as Record<string, unknown>) : null
  }

  async insert(lead: Lead): Promise<void> {
    await this.sql`
      insert into application_lead
        (id, email, chapter, source, filler_role, token_hash, created_at, expires_at, converted_at)
      values
        (${lead.id}, ${lead.email}, ${lead.chapter}, ${lead.source}, ${lead.fillerRole},
         ${lead.tokenHash}, ${lead.createdAt}, ${lead.expiresAt}, ${lead.convertedAt})
    `
  }

  async deleteExpired(now: Date): Promise<number> {
    const rows = await this.sql`
      delete from application_lead
      where converted_at is null and expires_at < ${now}
      returning id
    `
    return rows.length
  }
}
```

- [ ] **Step 3: Typecheck.**

Run: `npx tsc --noEmit`
Expected: no errors. (`postgres` types resolve from Task 4's install.)

- [ ] **Step 4: Commit.**

```bash
git add db/application_lead.sql lib/leads/postgres-store.ts
git commit -m "feat(leads): postgres LeadStore adapter and application_lead DDL"
```

---

## Task 9: The store factory

**Files:** Create `lib/leads/index.ts`

- [ ] **Step 1: Create `lib/leads/index.ts`:**

```ts
import postgres from 'postgres'
import type { LeadStore } from './types'
import { MemoryLeadStore } from './memory-store'
import { PostgresLeadStore } from './postgres-store'

let cached: LeadStore | null = null

/**
 * Production uses Postgres when DATABASE_URL is set; otherwise an in-memory store
 * (dev / paper-period fallback — non-persistent, with a warning).
 */
export function getLeadStore(): LeadStore {
  if (cached) return cached
  const url = process.env.DATABASE_URL
  if (url) {
    cached = new PostgresLeadStore(postgres(url))
  } else {
    console.warn('[leads] DATABASE_URL not set — using in-memory lead store (non-persistent).')
    cached = new MemoryLeadStore()
  }
  return cached
}

export * from './types'
export * from './service'
```

- [ ] **Step 2: Typecheck.**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit.**

```bash
git add lib/leads/index.ts
git commit -m "feat(leads): env-based LeadStore factory"
```

---

## Task 10: The pure apply handler — validation + dedup (TDD)

**Files:** Create `lib/apply-handler.ts`, `lib/apply-handler.test.ts`

- [ ] **Step 1: Write the failing test** `lib/apply-handler.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { handleApply } from './apply-handler'
import { MemoryLeadStore } from './leads/memory-store'

describe('handleApply validation', () => {
  it('400s on a bad email', async () => {
    const r = await handleApply({ email: 'nope', chapter: 'cwru', fillerRole: 'parent' }, { store: new MemoryLeadStore() })
    expect(r.status).toBe(400)
  })

  it('400s on an unknown chapter', async () => {
    const r = await handleApply({ email: 'p@example.com', chapter: 'mars', fillerRole: 'parent' }, { store: new MemoryLeadStore() })
    expect(r.status).toBe(400)
  })

  it('400s on a missing filler role', async () => {
    const r = await handleApply({ email: 'p@example.com', chapter: 'cwru' }, { store: new MemoryLeadStore() })
    expect(r.status).toBe(400)
  })

  it('200s and records a lead on a valid submission', async () => {
    const store = new MemoryLeadStore()
    const r = await handleApply(
      { email: 'p@example.com', chapter: 'cwru', fillerRole: 'parent', source: 'a friend' },
      { store },
    )
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ success: true })
    expect(store.leads).toHaveLength(1)
    expect(r.lead).toMatchObject({ suppressed: false, email: 'p@example.com', chapter: 'cwru', source: 'a friend', fillerRole: 'parent' })
  })

  it('reports suppression for an in-window duplicate but still 200s', async () => {
    const store = new MemoryLeadStore()
    await handleApply({ email: 'p@example.com', chapter: 'cwru', fillerRole: 'parent' }, { store })
    const r = await handleApply({ email: 'p@example.com', chapter: 'cwru', fillerRole: 'parent' }, { store })
    expect(r.status).toBe(200)
    expect(r.lead?.suppressed).toBe(true)
    expect(store.leads).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails.**

Run: `npm run test:web -- lib/apply-handler.test.ts`
Expected: FAIL — `handleApply` / module not found.

- [ ] **Step 3: Implement** `lib/apply-handler.ts`:

```ts
import { createLead } from './leads/service'
import type { FillerRole, LeadStore } from './leads/types'

export interface ApplyResult {
  status: number
  body: Record<string, unknown>
  /** Present only on a 200; lets the route decide what email to send. */
  lead?: {
    suppressed: boolean
    email: string
    chapter: string
    source: string | null
    fillerRole: FillerRole
  }
}

const EMAIL_RE = /.+@.+\..+/

export interface ApplyDeps {
  store: LeadStore
  now?: () => Date
}

/** Pure core of POST /api/apply: validate, dedup, record. No Next, no email. */
export async function handleApply(raw: unknown, deps: ApplyDeps): Promise<ApplyResult> {
  const body = (raw ?? {}) as Record<string, unknown>
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const chapter = typeof body.chapter === 'string' ? body.chapter : ''
  const fillerRole = typeof body.fillerRole === 'string' ? body.fillerRole : ''
  const source = typeof body.source === 'string' && body.source.trim() ? body.source.trim() : null

  if (!email || !EMAIL_RE.test(email)) {
    return { status: 400, body: { error: 'A valid email is required' } }
  }
  if (chapter !== 'cwru' && chapter !== 'other') {
    return { status: 400, body: { error: 'Choose a chapter' } }
  }
  if (fillerRole !== 'parent' && fillerRole !== 'student') {
    return { status: 400, body: { error: 'Tell us who is filling this out' } }
  }

  const result = await createLead({ email, chapter, source, fillerRole }, { store: deps.store, now: deps.now })

  return {
    status: 200,
    body: { success: true },
    lead: { suppressed: result.suppressed, email, chapter, source, fillerRole },
  }
}
```

- [ ] **Step 4: Run to verify it passes.**

Run: `npm run test:web -- lib/apply-handler.test.ts`
Expected: all five tests PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/apply-handler.ts lib/apply-handler.test.ts
git commit -m "feat(apply): pure handleApply core with validation and dedup"
```

---

## Task 11: Email builders (TDD)

**Files:** Create `lib/emails/apply.ts`, `lib/emails/apply.test.ts`

- [ ] **Step 1: Write the failing test** `lib/emails/apply.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildParentReceipt, buildStaffNotification } from './apply'

describe('email builders', () => {
  it('parent receipt does not promise a live application link', () => {
    const r = buildParentReceipt()
    expect(r.subject).toBeTruthy()
    expect(r.text).not.toMatch(/http/i) // no dead link — Stage 2 is not built
  })

  it('staff notification includes the lead facts', () => {
    const n = buildStaffNotification({ email: 'p@example.com', chapter: 'cwru', source: 'a friend', fillerRole: 'parent' })
    expect(n.text).toContain('p@example.com')
    expect(n.text).toContain('cwru')
    expect(n.text).toContain('a friend')
  })

  it('staff notification handles a missing source', () => {
    const n = buildStaffNotification({ email: 'p@example.com', chapter: 'cwru', source: null, fillerRole: 'student' })
    expect(n.text).toContain('(not provided)')
  })
})
```

- [ ] **Step 2: Run to verify it fails.**

Run: `npm run test:web -- lib/emails/apply.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `lib/emails/apply.ts`:

```ts
import type { FillerRole } from '../leads/types'

export interface Email {
  subject: string
  text: string
}

/** A receipt, not a live application link — Stage 2 is not built yet. */
export function buildParentReceipt(): Email {
  return {
    subject: 'We received your CurioLab interest',
    text: [
      'Thanks for your interest in CurioLab.',
      '',
      'We have your details, and a Chapter Director will be in touch soon with the next step.',
      'If you do not hear from us, check your spam folder or just reply to this email.',
      '',
      '— CurioLab',
    ].join('\n'),
  }
}

export function buildStaffNotification(lead: {
  email: string
  chapter: string
  source: string | null
  fillerRole: FillerRole
}): Email {
  return {
    subject: `New application lead: ${lead.chapter}`,
    text: [
      'A new Stage-1 application lead came in.',
      '',
      `Email:     ${lead.email}`,
      `Chapter:   ${lead.chapter}`,
      `Filled by: ${lead.fillerRole}`,
      `Heard via: ${lead.source ?? '(not provided)'}`,
      '',
      'Follow up per the paper-period process.',
    ].join('\n'),
  }
}
```

- [ ] **Step 4: Run to verify it passes.**

Run: `npm run test:web -- lib/emails/apply.test.ts`
Expected: all three tests PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/emails/apply.ts lib/emails/apply.test.ts
git commit -m "feat(apply): parent-receipt and staff-notification email builders"
```

---

## Task 12: The `/api/apply` route handler

**Files:** Create `app/api/apply/route.ts`

- [ ] **Step 1: Read the Next.js route-handler docs first** (per AGENTS.md).

Run: `ls node_modules/next/dist/docs/ && grep -rl "route" node_modules/next/dist/docs/ | head`
Then read the route-handler guide the grep surfaces. Confirm the `export async function POST(request: Request)` signature and `NextResponse.json` usage match this repo's version (they are already used in [app/api/contact/route.ts](../../../app/api/contact/route.ts)).

- [ ] **Step 2: Create `app/api/apply/route.ts`:**

```ts
import { Resend } from 'resend'
import { NextResponse } from 'next/server'
import { getLeadStore } from '@/lib/leads'
import { handleApply } from '@/lib/apply-handler'
import { buildParentReceipt, buildStaffNotification } from '@/lib/emails/apply'

const FROM = 'CurioLab <onboarding@resend.dev>'
const STAFF_RECIPIENT = 'aizma@curiolab.org'

export async function POST(request: Request) {
  try {
    const raw = await request.json().catch(() => ({}))
    const result = await handleApply(raw, { store: getLeadStore() })

    // Send email only for a fresh (non-suppressed) lead, best-effort:
    // a delivery failure must not lose the recorded lead.
    if (result.status === 200 && result.lead && !result.lead.suppressed && process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY)
      const parent = buildParentReceipt()
      const staff = buildStaffNotification(result.lead)
      try {
        await resend.emails.send({ from: FROM, to: result.lead.email, subject: parent.subject, text: parent.text })
        await resend.emails.send({ from: FROM, to: STAFF_RECIPIENT, subject: staff.subject, text: staff.text })
      } catch (err) {
        console.error('[apply] email send failed (lead was still recorded):', err)
      }
    }

    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Typecheck.**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit.**

```bash
git add app/api/apply/route.ts
git commit -m "feat(apply): POST /api/apply route with lead capture + emails"
```

---

## Task 13: The `/apply` Stage-1 form

**Files:** Create `app/apply/page.tsx`

- [ ] **Step 1: Read the App-Router page/client-component docs first** (per AGENTS.md) if not already reviewed in Task 12. Confirm `"use client"` + `useState` usage matches this repo's version (already used in [app/signup/page.tsx](../../../app/signup/page.tsx)).

- [ ] **Step 2: Create `app/apply/page.tsx`:**

```tsx
"use client";

import { useState } from "react";

type FillerRole = "parent" | "student";
type Status = "idle" | "submitting" | "done" | "error";

export default function ApplyPage() {
  const [email, setEmail] = useState("");
  const [fillerRole, setFillerRole] = useState<FillerRole>("parent");
  const [chapter, setChapter] = useState("");
  const [source, setSource] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    setError("");
    try {
      const res = await fetch("/api/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, fillerRole, chapter, source }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Something went wrong. Please try again.");
        setStatus("error");
        return;
      }
      setStatus("done");
    } catch {
      setError("Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <div className="mx-auto max-w-md px-6 py-20">
        <p className="label mb-3">Thank you</p>
        <h1 className="text-3xl md:text-4xl font-bold mb-6">You&apos;re on our radar</h1>
        <p className="text-muted">
          {fillerRole === "parent"
            ? "Check your email — we've sent a confirmation, and a Chapter Director will be in touch soon. If you don't see it, check your spam folder."
            : "We've emailed your parent or guardian. Ask them to look for a message from CurioLab, and to check the spam folder."}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-6 py-20">
      <p className="label mb-3">Get started</p>
      <h1 className="text-3xl md:text-4xl font-bold mb-4">Apply to CurioLab</h1>
      <p className="text-muted mb-8">
        Grades 6&ndash;12. No experience required &mdash; just curiosity. Tell us where to reach
        you and we&apos;ll send the next step.
      </p>

      <form className="space-y-6" onSubmit={onSubmit}>
        <div>
          <label className="label block mb-2">Parent or guardian email</label>
          <input
            className="w-full border border-black/20 rounded-md px-4 py-3 bg-white"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div>
          <label className="label block mb-2">Who is filling this out?</label>
          <div className="flex gap-6">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="fillerRole"
                checked={fillerRole === "parent"}
                onChange={() => setFillerRole("parent")}
              />
              <span>I&apos;m a parent or guardian</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="fillerRole"
                checked={fillerRole === "student"}
                onChange={() => setFillerRole("student")}
              />
              <span>I&apos;m a student</span>
            </label>
          </div>
        </div>

        <div>
          <label className="label block mb-2">Chapter</label>
          <select
            className="w-full border border-black/20 rounded-md px-4 py-3 bg-white"
            required
            value={chapter}
            onChange={(e) => setChapter(e.target.value)}
          >
            <option value="" disabled>
              Choose one&hellip;
            </option>
            <option value="cwru">Case Western Reserve University (Cleveland, OH)</option>
            <option value="other">Interested in another school</option>
          </select>
        </div>

        <div>
          <label className="label block mb-2">
            How did you hear about CurioLab?{" "}
            <span className="text-muted font-normal">(optional)</span>
          </label>
          <input
            className="w-full border border-black/20 rounded-md px-4 py-3 bg-white"
            type="text"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
        </div>

        {status === "error" && <p className="text-sm text-coral">{error}</p>}

        <button
          type="submit"
          disabled={status === "submitting"}
          className="w-full bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors disabled:opacity-60"
        >
          {status === "submitting" ? "Sending…" : "Send"}
        </button>
      </form>

      <p className="text-xs text-muted mt-6">
        We only ask for an email to start. We never collect anything about a student on this page.
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and lint.**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors (in particular no `react/no-unescaped-entities`).

- [ ] **Step 4: Commit.**

```bash
git add app/apply/page.tsx
git commit -m "feat(apply): Stage-1 application form at /apply"
```

---

## Task 14: Rewire the "apply" CTAs to `/apply`

**Files:** Modify `app/page.tsx:208`, `app/students/page.tsx:20`

- [ ] **Step 1: Homepage CTA.** In `app/page.tsx`, change the final-CTA link from `/students` to `/apply`:

Find:
```tsx
          <Link href="/students" className="bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors">
            Start an application →
          </Link>
```
Replace `href="/students"` with `href="/apply"` (leave the rest unchanged).

- [ ] **Step 2: Students-page CTA.** In `app/students/page.tsx`, replace the `mailto` anchor:

Find:
```tsx
        <a href="mailto:aizma@curiolab.org" className="inline-block bg-coral text-white px-8 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors">
          Application →
        </a>
```
Replace with:
```tsx
        <a href="/apply" className="inline-block bg-coral text-white px-8 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors">
          Apply →
        </a>
```

- [ ] **Step 3: Typecheck and lint.**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit.**

```bash
git add app/page.tsx app/students/page.tsx
git commit -m "feat(apply): point the apply CTAs at /apply"
```

---

## Task 15: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole web test suite.**

Run: `npm run test:web`
Expected: all lead/service, apply-handler, and email tests PASS.

- [ ] **Step 2: Typecheck + lint + production build.**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: clean typecheck, clean lint, successful Next build (the `/apply` page and `/api/apply` route appear in the build output).

- [ ] **Step 3: Manually exercise the form.** Use the `run` skill (or `npm run dev`) to launch the app, open `/apply`, and submit:
  - With no `RESEND_API_KEY` / no `DATABASE_URL` set: submission returns success, the confirmation screen shows the **parent** copy for the parent role and the **student** copy for the student role, and the server logs the in-memory-store warning. No crash.
  - Invalid email / no chapter: the form's own `required` + the route's 400 both reject.
  - Confirm the homepage "Start an application" and the students-page "Apply" buttons both land on `/apply`.

- [ ] **Step 4: Confirm no package files were touched.**

Run: `git status --short packages/`
Expected: only the backend agent's pre-existing untracked/modified entries — nothing this plan added or changed. (This plan must not have staged or modified anything under `packages/`.)

- [ ] **Step 5: Final review against the spec.** Re-read [the design spec](../specs/2026-07-22-application-funnel-stage-1-design.md) §4 scope list and confirm every Phase-1 item is done: docs reconciled, coordination plan written, `application_lead` table, `createLead` + `sweepExpiredLeads`, `/apply` form + route, parent-receipt + staff-notification emails, CTAs rewired, 30-day deletion job present.

---

## Self-review notes (author)

- **Spec coverage:** doc reconciliation (Tasks 1–2), coordination plan (Task 3), `application_lead` table (Task 8), `LeadService.createLead`/`sweepExpiredLeads` (Tasks 6–7), web form/route/emails (Tasks 11–13), CTA rewiring (Task 14), 30-day deletion job (Task 7 + Task 8 DDL index). Phase-2 rework is recorded, not built (Task 3), per the approved scope.
- **Not built (by design):** Stage 2A/2B/2C, Stage 3 consent, the `packages/*` rework, live pg-boss scheduling, the transactional email subdomain — all recorded as handoff/go-live items.
- **Type consistency:** `FillerRole`, `LeadStore` (`findRecentByEmail`/`insert`/`deleteExpired`), `createLead`/`sweepExpiredLeads`, and `handleApply`'s `ApplyResult.lead` shape are used identically across Tasks 5–13.
```

