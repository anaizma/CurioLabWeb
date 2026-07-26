# Feature B: Re-apply Resend + Date Column — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let a parent re-apply with the same email to get a fresh working link (old link goes stale) without piling up duplicate Interested rows, and replace the list's "Applied" column with a "Date" column showing the current status's effective time.

**Architecture:** Backend re-apply logic in `LeadService.createLead` (reuse the open lead, re-mint its token, refresh `last_requested_at`), a new `last_requested_at` column (migration 0041 + drizzle mirror), a `statusDate` on each applications-list item, and frontend plumbing for the Date column + resend UX.

**Tech stack:** TypeScript, `postgres` tagged templates, Drizzle schema mirror, Vitest + embedded Postgres, Next.js App Router.

**Concurrency note:** Only `app/apply/page.tsx` carries unrelated stranded WIP (a copy tweak). Task 7 (the only task touching it) is handled directly by the controller with git-stash isolation, NOT a subagent. All other tasks are on clean files and use `git add <explicit paths>` only.

---

### Task 1: Migration 0041 + schema mirror for `last_requested_at`

**Files:**
- Create: `packages/db/migrations/0041_application_lead_last_requested.sql`
- Modify: `packages/db/src/schema.ts` (the `applicationLead` table)

- [ ] **Step 1: Write the migration**

Create `packages/db/migrations/0041_application_lead_last_requested.sql`:

```sql
-- =========================================================================
-- 0041_application_lead_last_requested.sql — track the most recent time a
-- lead requested its application link.
--
-- A parent who loses the emailed link can re-apply with the same email; each
-- re-request re-mints the Stage-2 token and stamps last_requested_at = now()
-- (LeadService.createLead). The director dashboard's "Date" column reads this
-- as the effective time of an Interested row's current status.
--
-- Backfilled to created_at for existing rows (their only known request time),
-- then defaulted to now() and made NOT NULL so every lead always has one.
-- =========================================================================

ALTER TABLE application_lead ADD COLUMN last_requested_at timestamptz;
UPDATE application_lead SET last_requested_at = created_at WHERE last_requested_at IS NULL;
ALTER TABLE application_lead ALTER COLUMN last_requested_at SET DEFAULT now();
ALTER TABLE application_lead ALTER COLUMN last_requested_at SET NOT NULL;
```

- [ ] **Step 2: Mirror the column in the drizzle schema**

In `packages/db/src/schema.ts`, in the `applicationLead` pgTable definition, add after the `createdAt: createdAt(),` line (and before `expiresAt`):

```ts
    // The most recent time this lead requested its application link (0041). Set
    // to now() on create and on every re-apply resend; the dashboard "Date"
    // column reads it as an Interested row's current-status time.
    lastRequestedAt: timestamp('last_requested_at', { withTimezone: true }).notNull().defaultNow(),
```

- [ ] **Step 3: Verify the migration applies cleanly**

Run: `npm test -w @curiolab/app -- lead.test.ts` (the harness runs all migrations against embedded Postgres on boot; a broken migration fails at setup).
Expected: the existing lead tests still boot and run (some will change in Task 2; here we only confirm the migration + schema compile and the DB builds).

- [ ] **Step 4: Commit**

```bash
git add packages/db/migrations/0041_application_lead_last_requested.sql packages/db/src/schema.ts
git commit -m "feat(db): add application_lead.last_requested_at (migration 0041)"
```

---

### Task 2: Re-apply resend in `LeadService.createLead`

**Files:**
- Modify: `packages/app/src/lead.ts`
- Test: `packages/app/test/lead.test.ts`

- [ ] **Step 1: Update the tests to the new resend behavior**

In `packages/app/test/lead.test.ts`:

Replace the test `'a duplicate on email within the window is suppressed (no second row, no second token)'` (lines ~113-124) with:

```ts
  test('a repeat email on an OPEN lead resends: same row, fresh token, advanced last_requested_at, no duplicate', async () => {
    const email = `resend-${Date.now()}@example.test`
    const first = await service().createLead({ email, chapter: 'c', fillerRole: 'parent' })
    const [before] = await h.sql`select token_hash, last_requested_at from application_lead where id = ${first.leadId}`

    const second = await service().createLead({ email, chapter: 'c', fillerRole: 'parent' })
    expect(second.suppressed).toBe(false)
    expect(second.resent).toBe(true)
    expect(second.leadId).toBe(first.leadId)
    // A fresh token was minted (returned + stored), so the old link goes stale.
    expect(second.parentToken).not.toBeNull()
    const [after] = await h.sql`select token_hash, last_requested_at from application_lead where id = ${first.leadId}`
    expect(after!.token_hash).not.toBe(before!.token_hash)
    expect(new Date(after!.last_requested_at).getTime()).toBeGreaterThanOrEqual(new Date(before!.last_requested_at).getTime())
    // Still exactly one row for this email.
    const [row] = await h.sql`select count(*)::int as n from application_lead where email = ${email}`
    expect(row!.n).toBe(1)
  })

  test('the resent parentToken drives startStage2 (the fresh link works); the old token no longer resolves', async () => {
    const email = `resend-token-${Date.now()}@example.test`
    const first = await service().createLead({ email, chapter: 'c', fillerRole: 'parent' })
    const oldToken = first.parentToken!
    const second = await service().createLead({ email, chapter: 'c', fillerRole: 'parent' })
    const newToken = second.parentToken!
    expect(newToken).not.toBe(oldToken)
    // The fresh token starts Stage 2 on the SAME lead; the stale one is rejected.
    const started = await new Stage2Service({ sql: h.sql }).startStage2(newToken)
    expect(started.leadId).toBe(first.leadId)
    await expect(new Stage2Service({ sql: h.sql }).startStage2(oldToken)).rejects.toThrow()
  })

  test('a repeat email whose only prior lead is CONVERTED creates a NEW lead (fresh interest)', async () => {
    const email = `converted-reapply-${Date.now()}@example.test`
    const first = await service().createLead({ email, chapter: 'c', fillerRole: 'parent' })
    // Simulate conversion (the funnel would set these at submit).
    await h.sql`update application_lead set status = 'converted', converted_application_id = null, converted_at = now() where id = ${first.leadId}`
    // Give it a real converted_application_id via a throwaway application so the fk holds.
    const [app] = await h.sql`insert into application (kind, chapter_id, status, applicant_name) values ('student', null, 'submitted', 'Test Child') returning id`
    await h.sql`update application_lead set converted_application_id = ${app!.id} where id = ${first.leadId}`

    const second = await service().createLead({ email, chapter: 'c', fillerRole: 'parent' })
    expect(second.resent).toBe(false)
    expect(second.suppressed).toBe(false)
    expect(second.leadId).not.toBe(first.leadId)
    const [row] = await h.sql`select count(*)::int as n from application_lead where email = ${email}`
    expect(row!.n).toBe(2)
  })
```

Also update the two tests that assert window-based suppression, since suppression is retired. Replace `'a resubmission OUTSIDE the dedupe window is not suppressed (the window is honored)'` and `'the dedupe window comes from config: a tighter window stops deduping a backdated lead'` and `'the dedupe is case-insensitive on email (citext)'` and the `'a suppressed duplicate returns parentToken: null'` test as follows:

- `'the dedupe is case-insensitive on email (citext)'` (lines ~126-132): change the assertions from `second.suppressed`/same-lead-suppressed to resend semantics:
```ts
  test('re-apply matches the email case-insensitively (citext): same lead, resent', async () => {
    const base = `Case-${Date.now()}@Example.Test`
    const first = await service().createLead({ email: base, chapter: 'c', fillerRole: 'parent' })
    const second = await service().createLead({ email: base.toLowerCase(), chapter: 'c', fillerRole: 'parent' })
    expect(second.resent).toBe(true)
    expect(second.leadId).toBe(first.leadId)
  })
```
- Delete the two window-specific tests (`'a resubmission OUTSIDE the dedupe window...'` and `'the dedupe window comes from config...'`) — the window no longer gates reuse; an open lead is always reused regardless of age.
- In the `'createLead — the returned parentToken'` describe, replace `'a suppressed duplicate returns parentToken: null (no new token minted)'` (lines ~203-210) with:
```ts
  test('a re-apply returns a FRESH non-null parentToken (a new link is minted)', async () => {
    const email = `dupe-token-${Date.now()}@example.test`
    const first = await service().createLead({ email, chapter: 'c', fillerRole: 'parent' })
    const second = await service().createLead({ email, chapter: 'c', fillerRole: 'parent' })
    expect(second.resent).toBe(true)
    expect(second.parentToken).not.toBeNull()
    expect(second.parentToken).not.toBe(first.parentToken)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @curiolab/app -- lead.test.ts`
Expected: FAIL — `resent` does not exist on the result; re-apply currently suppresses.

- [ ] **Step 3: Implement the resend logic**

In `packages/app/src/lead.ts`:

Add `resent: boolean` to `CreateLeadResult`:
```ts
export interface CreateLeadResult {
  leadId: string
  /** Retired: always false now (re-apply resends rather than suppressing). Kept for callers. */
  suppressed: boolean
  /** True when a repeat email reused an open lead and re-minted its link. */
  resent: boolean
  parentToken: string | null
}
```

Replace the dedupe block (the `const cutoff = ...; const existing = await this.sql\`...\`; if (existing.length > 0) { return { ..., suppressed: true, parentToken: null } }`) with an OPEN-lead reuse-and-resend:

```ts
    // Re-apply: reuse the most recent OPEN (not-yet-converted, not-deleted) lead
    // for this email, regardless of age. A parent who lost the link gets a FRESH
    // one (the old goes stale) without a duplicate row. Only when no open lead
    // exists (all prior converted/deleted) do we create a new lead below.
    const [openLead] = await this.sql`
      select id from application_lead
      where email = ${input.email}
        and deleted_at is null
        and converted_application_id is null
      order by created_at desc
      limit 1
    `
    if (openLead) {
      const leadId = openLead.id as string
      const rawToken = generateSessionToken()
      const tokenHash = hashToken(rawToken)
      const now = new Date()
      const expiresAt = new Date(now.getTime() + this.config.leadExpiryWindowMs)
      // Re-mint the lead's Stage-2 token, refresh the window, stamp the request time.
      await this.sql`
        update application_lead
        set token_hash = ${tokenHash}, expires_at = ${expiresAt}, last_requested_at = ${now}
        where id = ${leadId}
      `
      // If a draft was already started, carry the fresh token onto it so the new
      // link resolves the in-progress draft (answers preserved) and the old dies.
      await this.sql`
        update application_draft set parent_token_hash = ${tokenHash} where lead_id = ${leadId}
      `
      const parentToken = input.fillerRole === 'parent' ? rawToken : null
      // A student-filler gets the fresh link mailed to the parent, same as a new lead.
      if (input.fillerRole === 'student') {
        const link = `${this.config.appUrl}/apply/parent/${rawToken}`
        try {
          await this.mailer.send({
            to: input.email,
            subject: 'Your CurioLab application link',
            text:
              'Here is a fresh link to continue the CurioLab application:\n\n' +
              `${link}\n\n` +
              'This link is personal to you - please do not share it. Any earlier link is now inactive.',
            html:
              '<p>Here is a fresh link to continue the CurioLab application:</p>' +
              `<p><a href="${link}">${link}</a></p>` +
              '<p>This link is personal to you - please do not share it. Any earlier link is now inactive.</p>',
          })
        } catch (err) {
          console.error(`[LeadService] resend Stage-2 link email failed for lead ${leadId}:`, err)
        }
      }
      return { leadId, suppressed: false, resent: true, parentToken }
    }
```

Then in the new-lead insert path below, set `last_requested_at` explicitly and add `resent: false` to the returned object. Change the insert column list + values to include `last_requested_at`:
```ts
    const [row] = await this.sql`
      insert into application_lead
        (email, chapter, chapter_id, source, filler_role, status, token_hash, created_at, expires_at, last_requested_at)
      values
        (${input.email}, ${input.chapter}, ${chapterId}, ${source}, ${input.fillerRole},
         'new', ${tokenHash}, ${now}, ${expiresAt}, ${now})
      returning id
    `
```
and the final `return { leadId: row!.id as string, suppressed: false, parentToken }` becomes `return { leadId: row!.id as string, suppressed: false, resent: false, parentToken }`.

Note: the `leadDedupeWindowMs` config field is now unused by createLead. Leave the config field and constant in place (other code/tests reference the type); do not delete them.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @curiolab/app -- lead.test.ts`
Expected: PASS (the rewritten resend tests + the untouched create/parentToken tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/lead.ts packages/app/test/lead.test.ts
git commit -m "feat(apply): re-apply resends a fresh link and reuses the open lead"
```

---

### Task 3: `statusDate` on the applications list

**Files:**
- Modify: `packages/app/src/ops-read.ts`
- Test: `packages/http/test/ops-read.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/http/test/ops-read.test.ts`, add to the `'Interested leads'` describe (or a new describe at end):

```ts
  test('an interested lead statusDate equals its last_requested_at', async () => {
    const a = await seedDirector(h.sql)
    const [lead] = await h.sql`
      insert into application_lead (email, chapter, chapter_id, filler_role, status, expires_at, last_requested_at)
      values ('sd-lead@example.test', 'code', ${a.chapter}, 'parent', 'new', now() + interval '30 days', now() - interval '2 days')
      returning id, last_requested_at`
    const res = await listApplications({ sql: h.sql, sessionToken: a.directorToken, query: { termId: 'all', view: 'full' } })
    const item = res.body.items.find((i) => i.contactEmail === 'sd-lead@example.test')
    expect(item).toBeDefined()
    expect(new Date(item!.statusDate).getTime()).toBe(new Date(lead!.last_requested_at as string).getTime())
  })

  test('an application statusDate reflects its latest status-change event', async () => {
    const a = await seedDirector(h.sql)
    const appId = await submittedApplication(a.chapter)
    // Move to screening with a later event; statusDate should track the screening time.
    await h.sql`update application set status = 'screening' where id = ${appId}`
    const at = new Date(Date.now() - 60_000)
    await h.sql`insert into application_event (application_id, from_status, to_status, at) values (${appId}, 'submitted', 'screening', ${at})`
    const res = await listApplications({ sql: h.sql, sessionToken: a.directorToken, query: { termId: 'all', view: 'full' } })
    const item = res.body.items.find((i) => i.applicationId === appId)
    expect(item).toBeDefined()
    expect(new Date(item!.statusDate).getTime()).toBe(at.getTime())
  })
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -w @curiolab/http -- ops-read.test.ts`
Expected: FAIL — `statusDate` is undefined.

- [ ] **Step 3: Implement**

In `packages/app/src/ops-read.ts`:

Add to `ApplicationListItem` (after `submittedAt`):
```ts
  /** The effective time of the row's CURRENT status: for a lead, last_requested_at;
   *  for an application, the latest status-change event.at (fallback created_at). */
  statusDate: string
```

In the applications query (the `select a.id, a.status, ...`), add a lateral subquery for the current-status event time and select it. Add after the `ct` lateral join:
```ts
      left join lateral (
        select at from application_event
        where application_id = a.id and to_status = a.status
        order by at desc limit 1
      ) se on true
```
and add `se.at as status_at` to the select list. In the application item mapping, set:
```ts
        statusDate: iso((r.status_at as Date | null) ?? (r.created_at as Date)),
```

In the lead item mapping (the `leadItems = leadRows.map(...)`), select `l.last_requested_at` in the lead query and set:
```ts
        statusDate: iso(r.last_requested_at as Date),
```
(Add `l.last_requested_at` to the lead `select` column list.)

- [ ] **Step 4: Run to verify pass**

Run: `npm test -w @curiolab/http -- ops-read.test.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/ops-read.ts packages/http/test/ops-read.test.ts
git commit -m "feat(ops): statusDate (current-status effective time) on the applications list"
```

---

### Task 4: Thread `statusDate` through the data layer

**Files:**
- Modify: `lib/portal/director/applications-data.ts`

- [ ] **Step 1: Add the field + label**

In `lib/portal/director/applications-data.ts`:
- Add to `ApplicationRow`: `statusDateLabel: string;` (after `submittedLabel`).
- Add to `LiveListItem`: `statusDate?: string;` (after `submittedAt`).
- In the live mapper, add: `statusDateLabel: fmt(a.statusDate),`.
- In the sample `toRow` mapper, add `statusDateLabel: a.submittedLabel,` (samples have no separate status date; reuse the submitted label so the sample view renders).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: the only error is in `app/portal/director/applications/page.tsx` (doesn't yet render the new column) — fixed in Task 5. No error in `applications-data.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/portal/director/applications-data.ts
git commit -m "feat(portal): carry statusDate through the applications data layer"
```

---

### Task 5: "Date" column in the applications list page

**Files:**
- Modify: `app/portal/director/applications/page.tsx`

- [ ] **Step 1: Replace the Applied column with Date next to Status**

In `app/portal/director/applications/page.tsx`:
- Change `COLS` to drop the 2nd (Applied) slot and add a Date slot before Status:
```ts
const COLS = "minmax(0,1.5fr) minmax(0,1.5fr) minmax(0,2fr) minmax(0,1.3fr) 6rem 5.5rem";
```
- Header row: remove the `<div class="label ...">Applied</div>` at position 2; keep Name, School, Email, Parent, then add `<div className="label text-[10.5px]">Date</div>` immediately before the Status header.
- In each row's `cells`, remove the old "Applied" cell (the `submittedLabel` + term block at position 2). Add, immediately before the Status cell:
```tsx
                  {/* Date - effective time of the current status */}
                  <div className="text-xs text-ink/55 whitespace-nowrap">
                    {a.statusDateLabel}
                    {showingAll && a.termName ? <span className="block text-ink/40">{a.termName}</span> : null}
                  </div>
```
- Ensure the cell order in `cells` is now: Name, School, Email, Parent, Date, Status (6 cells matching COLS).

- [ ] **Step 2: Typecheck + lint (scoped)**

Run: `npx tsc --noEmit -p tsconfig.json` (no errors in this file) and `npx eslint app/portal/director/applications/page.tsx` (clean).

- [ ] **Step 3: Commit**

```bash
git add app/portal/director/applications/page.tsx
git commit -m "feat(portal): Date column (current-status time) replaces Applied, next to Status"
```

---

### Task 6: Thread `resent` through the apply route

**Files:**
- Modify: `app/api/apply/route.ts`

- [ ] **Step 1: Return `resent` and only notify the director for a NEW lead**

In `app/api/apply/route.ts`:
- The response JSON: add `resent: result.resent` to the `Response.json({ ... }, { status: 201 })` object.
- The director-notification guard currently fires on `!result.suppressed`. Change it to fire only for a genuinely new lead: `if (!result.resent && process.env.RESEND_API_KEY) { ... }` (a resend just refreshes an existing lead the director already saw).
- The existing parent-continue-email block sends whenever `result.parentToken` is set; a resend returns a fresh `parentToken`, so this already re-emails the parent their fresh link — no change needed there.

- [ ] **Step 2: Typecheck + funnel test**

Run: `npx tsc --noEmit -p tsconfig.json` (clean for this file) and `npm run test:web -- test/apply-funnel-flow.test.ts` (PASS).

- [ ] **Step 3: Commit**

```bash
git add app/api/apply/route.ts
git commit -m "feat(apply): return resent flag; notify director only for a new lead"
```

---

### Task 7: Resend UX on the apply page (CONTROLLER-ONLY — stranded WIP in this file)

**Files:**
- Modify: `app/apply/page.tsx`

**This file has unrelated uncommitted WIP. The controller handles it directly with git-stash isolation, NOT a subagent:**
1. `git stash push app/apply/page.tsx` (isolates the stranded copy-tweak WIP; file reverts to HEAD).
2. Make the edits below.
3. `git add app/apply/page.tsx && git commit` the Feature B change.
4. `git stash pop` to restore the stranded WIP on top (different regions → no conflict).

- [ ] **Step 1: Add `resent` to the result shape + handler**

In `app/apply/page.tsx`:
- `ApplyResult` interface: add `resent: boolean;`.
- In `handleSubmit`, when building `setResult({...})`, add `resent: Boolean(body.resent),`.

- [ ] **Step 2: Replace the suppressed branch with a resent-aware message**

Replace the `result.suppressed ? (...)` branch. The result block should read: on `resent` for a parent-filler with a token, show a "we re-sent your link" heading + the continue button; on `resent` for a student-filler, show "we re-sent the link to your parent"; otherwise the existing new-lead copy. Concretely, change the top of the ternary chain from `{result.suppressed ? (<p>...already have a recent application...</p>) : result.fillerRole === "parent" && result.parentToken ? (` to lead with the resent-aware parent branch:

```tsx
      {result.fillerRole === "parent" && result.parentToken ? (
            <>
              <h2 className="text-2xl font-bold mb-2">
                {result.resent ? "We re-sent your link" : "Check your email"}
              </h2>
              <p className="text-black">
                {result.resent
                  ? "We've emailed you a fresh application link. Any earlier link is now inactive. You can also continue right now."
                  : "We've sent you the application link. You can also continue right now."}
              </p>
              <Link
                href={`/apply/parent/${result.parentToken}`}
                className="inline-block bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors"
              >
                Continue to your application →
              </Link>
              <p className="text-sm text-muted">
                The emailed link works too - both go to the same application.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-bold mb-2">
                {result.resent ? "We re-sent the link to your parent" : "We've emailed your parent"}
              </h2>
              <p className="text-black">
                Ask them to look for a message from CurioLab, and to check the spam folder.
              </p>
            </>
          )}
```

(This removes the `result.suppressed` branch entirely; `suppressed` is retired.) Do NOT introduce em dashes in the copy - use "-".

- [ ] **Step 3: Verify + commit (controller, with stash flow above)**

Run: `npx tsc --noEmit -p tsconfig.json` (clean) and `npx eslint app/apply/page.tsx` (clean).
Then commit only this file and restore the stashed WIP:
```bash
git add app/apply/page.tsx
git commit -m "feat(apply): resent-aware confirmation copy on the apply page"
git stash pop
```

---

## Self-Review Notes

- **Spec coverage:** re-apply resend (Task 2), no-duplicate reuse (Task 2), last_requested_at (Task 1), Date column = current-status time (Tasks 3-5), resend UX + notify-only-on-new (Tasks 6-7). All covered.
- **Type consistency:** `resent` added to `CreateLeadResult` (Task 2), the apply route response (Task 6), and `ApplyResult` (Task 7). `statusDate` added to `ApplicationListItem` (Task 3), `LiveListItem` + `ApplicationRow.statusDateLabel` (Task 4), rendered (Task 5).
- **Concurrency:** only Task 7 touches the WIP file, and it's controller-run with stash isolation. Every other task stages explicit clean-file paths.
- **Migration:** 0041 is the next free number (0040 is the committed password-change migration).
