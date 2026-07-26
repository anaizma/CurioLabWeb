# Feature C: Duplicate-applicant flag — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** When a new application's child name + DOB matches an existing application in the same chapter, flag it (non-blocking) in the director dashboard, with a manual "clear" action.

**Architecture:** Detection at submit (`submitStage2`) stamps four new `application` columns (migration 0043). A gated `clearDuplicateFlag` ops action dismisses it. Reads surface a `duplicateFlag` boolean (list) and a `duplicate` object (detail); the frontend shows a badge + a banner with a Clear button.

**Tech stack:** TypeScript, `postgres` tagged templates, Drizzle mirror, Vitest + embedded Postgres, Next.js App Router.

**Locked decisions:** same-chapter matching; flag against any prior status (incl. declined); match = `normalizeGuardianName(childName)` equal AND `childDob` string-equal; the later app is flagged pointing at the earliest match; non-blocking; manually + permanently clearable per app.

---

### Task 1: Migration 0043 + schema mirror

**Files:** Create `packages/db/migrations/0043_application_duplicate_flag.sql`; modify `packages/db/src/schema.ts` (`application` table).

- [ ] **Step 1: Migration**

```sql
-- =========================================================================
-- 0043_application_duplicate_flag.sql — a non-blocking duplicate-applicant flag.
--
-- At submit, if a new application's child name + date of birth matches an
-- existing application in the SAME chapter, it is flagged for the director to
-- review manually (submitStage2). The flag never blocks submission. A director
-- dismisses a false positive via the clear-duplicate-flag ops action, which
-- stamps duplicate_cleared_at/by. "Actively flagged" = flagged_at not null AND
-- cleared_at null. No backfill: the flag applies to new submissions going forward.
-- =========================================================================

ALTER TABLE application ADD COLUMN duplicate_flagged_at timestamptz;
ALTER TABLE application ADD COLUMN duplicate_of_application_id uuid REFERENCES application(id);
ALTER TABLE application ADD COLUMN duplicate_cleared_at timestamptz;
ALTER TABLE application ADD COLUMN duplicate_cleared_by uuid REFERENCES account(id);
```

- [ ] **Step 2: Schema mirror** — in `packages/db/src/schema.ts`, in the `application` pgTable (search `export const application = pgTable('application'`), add before `createdAt: createdAt(),`:

```ts
  // Non-blocking duplicate-applicant flag (0043). Stamped at submit when the
  // child name + DOB matches an existing same-chapter application; cleared by a
  // director dismissing a false positive. Flagged = flaggedAt set & clearedAt null.
  duplicateFlaggedAt: timestamp('duplicate_flagged_at', { withTimezone: true }),
  duplicateOfApplicationId: uuid('duplicate_of_application_id').references((): AnyPgColumn => application.id),
  duplicateClearedAt: timestamp('duplicate_cleared_at', { withTimezone: true }),
  duplicateClearedBy: uuid('duplicate_cleared_by').references(() => account.id),
```
(`AnyPgColumn` is already imported and used by `reopenedFromId`/`formId` self-refs — match that pattern.)

- [ ] **Step 3: Verify** — `npm test -w @curiolab/app -- stage2.test.ts` (harness applies all migrations on boot; confirm it boots + `npx tsc --noEmit -p packages/db/tsconfig.json` clean).

- [ ] **Step 4: Commit**
```bash
git add packages/db/migrations/0043_application_duplicate_flag.sql packages/db/src/schema.ts
git commit -m "feat(db): application duplicate-flag columns (migration 0043)"
```

---

### Task 2: Detection at submit (`submitStage2`)

**Files:** Modify `packages/app/src/stage2.ts`; Test `packages/app/test/stage2.test.ts`.

- [ ] **Step 1: Write the failing test(s)**

Read `packages/app/test/stage2.test.ts` first to reuse its full-funnel helpers (there is existing machinery that drives createLead → startStage2 → save 2A → 2B → submit). Add tests asserting:
- Two applications submitted in the SAME chapter with the same child name and same `childDob` → the SECOND application has `duplicate_flagged_at` set and `duplicate_of_application_id` = the first application's id (query `application` directly). The first is NOT flagged.
- Same name but DIFFERENT `childDob` → not flagged. (And/or different name, same DOB → not flagged.)
- A match in a DIFFERENT chapter → not flagged.

If driving two full funnels is heavy, seed the FIRST application + its converted draft directly via SQL (an `application` row + an `application_draft` with `converted_application_id` = that app and `parent_answers` jsonb containing `childDob` and `childName`), then run ONE real funnel submit for the second with matching name+DOB and assert the flag. Use the chapter/term the test already seeds. Child name flows to `application.applicant_name` from `parent.childName`; DOB is `parent.childDob`.

- [ ] **Step 2: Run → FAIL** (`npm test -w @curiolab/app -- stage2.test.ts`) — the flag columns are never set.

- [ ] **Step 3: Implement detection**

In `packages/app/src/stage2.ts`:
- Add an import for the name normalizer: `import { normalizeGuardianName } from './config.js'` (confirm the exact export path — it lives in `packages/app/src/config.ts`).
- In `submitStage2`, inside the existing `this.sql.begin(async (tx) => { ... })`, AFTER the `application` insert (you have `appId` / the returned id), the lead update, and the draft update, add duplicate detection. `childName` is already computed above; read `childDob` from `parent`:

```ts
      // Non-blocking duplicate flag: if this child name + DOB matches an existing
      // application in the same chapter, stamp a flag for the director to review.
      // Additive only - never blocks the submit. Name is normalized (NFC/case/space);
      // DOB is an exact match on the same date-input value. childDob is a required 2A
      // field; guard defensively if absent.
      const childDob = strOrNull(parent.childDob)
      if (childDob !== null) {
        const candidates = await tx`
          select a.id, a.applicant_name
          from application a
          join application_draft d on d.converted_application_id = a.id
          where a.chapter_id = ${chapterId}
            and a.id <> ${appId}
            and d.parent_answers->>'childDob' = ${childDob}
          order by a.created_at asc
        `
        const target = normalizeGuardianName(childName)
        const match = candidates.find(
          (c) => normalizeGuardianName(c.applicant_name as string) === target,
        )
        if (match) {
          await tx`
            update application
            set duplicate_flagged_at = now(), duplicate_of_application_id = ${match.id as string}
            where id = ${appId}
          `
        }
      }
```
Confirm `strOrNull` and `chapterId`, `childName`, `appId` are the real in-scope names in `submitStage2` (adapt if the app id variable differs — it is the `returning id` from the application insert). `childName` is guaranteed non-null here (the code throws earlier if it is null), so `normalizeGuardianName(childName)` is safe.

- [ ] **Step 4: Run → PASS** (`npm test -w @curiolab/app -- stage2.test.ts`).

- [ ] **Step 5: Commit**
```bash
git add packages/app/src/stage2.ts packages/app/test/stage2.test.ts
git commit -m "feat(apply): flag a duplicate applicant (name+DOB) at submit"
```

---

### Task 3: Clear action — service method + controller

**Files:** Modify `packages/app/src/service.ts` (`ApplicationService`) and `packages/http/src/controllers/ops.ts`. Test: add to an existing ops/application test (e.g. `packages/http/test/ops.test.ts` or `packages/app/test/transitions.test.ts` — check which covers ApplicationService transitions and mirror it).

- [ ] **Step 1: Write the failing test**

Find where `ApplicationService` transitions are tested (search for `.screen(` / `.decline(` in `packages/app/test` and `packages/http/test`). Mirror that setup to add:
- `clearDuplicateFlag` on a flagged application sets `duplicate_cleared_at` (not null) and `duplicate_cleared_by` = the acting director's account id, and leaves `duplicate_flagged_at` intact.
- A cross-chapter / non-director caller is Forbidden (gated on `application.transition`), consistent with the other transitions' authorization tests.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

In `packages/app/src/service.ts`, `ApplicationService`, add a method near the other transitions (it is NOT a status transition — no `canTransition`, no event):

```ts
  /**
   * Dismiss a duplicate-applicant flag (a director's manual "not a duplicate"
   * decision). Gated on `application.transition` (chapter-scoped). Stamps
   * duplicate_cleared_at/by; leaves duplicate_flagged_at/of_application_id intact
   * as the audit trail. Not a status change, so no application_event is written
   * (that would corrupt the current-status "Date"). Harmless no-op if unflagged.
   */
  async clearDuplicateFlag(ctx: AuthContext, input: TransitionInput): Promise<{ applicationId: string }> {
    const app = await this.load(input.applicationId)
    const resource: Resource = { id: app.id, chapter_id: app.chapterId }
    await this.authorize(ctx, 'application.transition', resource, { sql: this.sql })
    await this.sql.begin(async (tx) => {
      assertAuthorized()
      await tx`
        update application
        set duplicate_cleared_at = now(), duplicate_cleared_by = ${ctx.account.id}
        where id = ${app.id}
      `
    })
    return { applicationId: app.id }
  }
```
(`this.load`, `Resource`, `assertAuthorized`, `TransitionInput`, `ctx.account.id` are all already used by the neighboring methods — match them.)

In `packages/http/src/controllers/ops.ts`, in the `transitionApplication` switch (the `switch (action) { case 'screen': ... }`), add:
```ts
      case 'clear-duplicate-flag':
        outcome = await svc.clearDuplicateFlag(ctx, tinput)
        break
```
Confirm the surrounding `outcome` handling returns a sensible body (mirror how `screen`/`decline` outcomes are returned; `clearDuplicateFlag` returns `{ applicationId }`, so if the switch's response builder reads `outcome.from`/`outcome.to`, guard or return `{ applicationId }` — match the existing shape, adapting minimally so the response is valid JSON with the applicationId).

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit**
```bash
git add packages/app/src/service.ts packages/http/src/controllers/ops.ts <test file>
git commit -m "feat(ops): clear-duplicate-flag action (director dismiss)"
```

---

### Task 4: Surface the flag in the ops reads

**Files:** Modify `packages/app/src/ops-read.ts`; Test `packages/http/test/ops-read.test.ts`.

- [ ] **Step 1: Failing tests**

Add tests: a flagged application (set `duplicate_flagged_at` via SQL) surfaces `duplicateFlag: true` in `listApplications`; after also setting `duplicate_cleared_at`, it surfaces `false`. In `getApplication` detail, a flagged app returns `duplicate.flagged === true`, `duplicate.ofApplicationId` = the matched id, `duplicate.ofApplicantName` = the matched app's applicant_name, and (when cleared) `duplicate.clearedAt` set / `flagged` false.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

In `packages/app/src/ops-read.ts`:
- `ApplicationListItem`: add `duplicateFlag: boolean`. In the applications query select add `a.duplicate_flagged_at`, `a.duplicate_cleared_at`; in the app-row map set `duplicateFlag: (r.duplicate_flagged_at as Date | null) != null && (r.duplicate_cleared_at as Date | null) == null`. In the LEAD-row map set `duplicateFlag: false`.
- `ApplicationDetail`: add `duplicate: { flagged: boolean; ofApplicationId: string | null; ofApplicantName: string | null; clearedAt: string | null }`. In `getApplication`, select the four duplicate columns; also `left join application dup on dup.id = a.duplicate_of_application_id` to get `dup.applicant_name as duplicate_of_name`. Build the object: `flagged = flagged_at != null && cleared_at == null`, `ofApplicationId = duplicate_of_application_id`, `ofApplicantName = duplicate_of_name`, `clearedAt = iso(cleared_at)` or null.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit**
```bash
git add packages/app/src/ops-read.ts packages/http/test/ops-read.test.ts
git commit -m "feat(ops): surface duplicate flag in application list + detail reads"
```

---

### Task 5: Thread the flag through the data layer

**Files:** Modify `lib/portal/director/applications-data.ts`.

- [ ] **Step 1** — In `applications-data.ts`:
  - `ApplicationRow`: add `duplicateFlag?: boolean`.
  - `LiveListItem`: add `duplicateFlag?: boolean`. Live mapper: `duplicateFlag: a.duplicateFlag ?? false`. Sample `toRow`: `duplicateFlag: false`.
  - `ApplicationDetail` (the frontend one): add `duplicate: { flagged: boolean; ofApplicationId: string | null; ofApplicantName: string | null; clearedAt: string | null } | null`. In the live detail mapper (`getApplicationDetail`), map `d.duplicate ?? null` (the backend returns the object); in the SAMPLE detail(s), set `duplicate: null`. Add the field to the `LiveDetail` interface it parses.
- [ ] **Step 2** — `npx tsc --noEmit -p tsconfig.json` (only expected errors are in the pages that render, fixed in Tasks 6-7).
- [ ] **Step 3** — Commit:
```bash
git add lib/portal/director/applications-data.ts
git commit -m "feat(portal): carry the duplicate flag through the applications data layer"
```

---

### Task 6: "Possible duplicate" badge in the list page

**Files:** Modify `app/portal/director/applications/page.tsx`.

- [ ] **Step 1** — In the Name cell of each row, when `a.duplicateFlag` is true (and it is not a lead — leads are never flagged), render a small amber pill after the name/grade, e.g.:
```tsx
{a.duplicateFlag && (
  <span className="text-[10px] font-semibold rounded-full px-1.5 py-0.5 whitespace-nowrap shrink-0" style={{ background: "#FBF0DA", color: "#8A5A00" }} title="Possible duplicate applicant (name + DOB match)">
    Possible duplicate
  </span>
)}
```
Place it inside the existing Name `<div className="flex items-center gap-2 min-w-0">` so it sits with the name; it must not break the 6-column grid (it is inside the Name cell, not a new column).
- [ ] **Step 2** — `npx tsc --noEmit -p tsconfig.json` clean for this file; `npx eslint app/portal/director/applications/page.tsx` clean.
- [ ] **Step 3** — Commit:
```bash
git add app/portal/director/applications/page.tsx
git commit -m "feat(portal): possible-duplicate badge on flagged application rows"
```

---

### Task 7: Duplicate banner + Clear button on the detail page

**Files:** Modify `app/portal/director/applications/[id]/page.tsx`.

- [ ] **Step 1** — Read the detail page. When `detail.duplicate?.flagged`, render an amber banner ABOVE the applicant-info card (near the interview banner), e.g.:
```tsx
{detail.duplicate?.flagged && (
  <div className="rounded-sm px-4 py-2.5 text-[13px] flex items-center justify-between gap-3 flex-wrap" style={{ background: "#FBF0DA", color: "#8A5A00" }}>
    <div>
      <span className="font-semibold">Possible duplicate applicant.</span>{" "}
      Matches {detail.duplicate.ofApplicantName ?? "an existing application"} by name + date of birth.
      {detail.duplicate.ofApplicationId && (
        <> <Link href={`/portal/director/applications/${detail.duplicate.ofApplicationId}`} className="underline font-medium">View the other application</Link>.</>
      )}
    </div>
    {!isSample && (
      <OpsActionButton method="PATCH" url={`/api/ops/applications/${detail.applicationId}`} body={{ action: "clear-duplicate-flag" }} label="Not a duplicate" variant="outline" confirmText="Dismiss the duplicate flag for this application?" />
    )}
  </div>
)}
```
(Reuse the existing `OpsActionButton` and `Link` imports already in the file. Match the existing banner styling conventions; the interview banner is a good reference.) No em dashes in copy.
- [ ] **Step 2** — `npx tsc --noEmit -p tsconfig.json` clean; `npx eslint "app/portal/director/applications/[id]/page.tsx"` clean.
- [ ] **Step 3** — Commit:
```bash
git add "app/portal/director/applications/[id]/page.tsx"
git commit -m "feat(portal): duplicate banner + dismiss button on the application detail"
```

---

## Self-Review Notes

- **Spec coverage:** schema (T1), detection at submit (T2), clear action (T3), reads (T4), data layer (T5), list badge (T6), detail banner+clear (T7). All covered.
- **Type consistency:** `duplicateFlag` on `ApplicationListItem` (T4) → `LiveListItem`/`ApplicationRow` (T5) → list page (T6). `duplicate` object on `ApplicationDetail` (T4) → data-layer `ApplicationDetail` (T5) → detail page (T7). `clearDuplicateFlag` (T3 service) ↔ `clear-duplicate-flag` action (T3 controller) ↔ detail button body (T7).
- **No status-event corruption:** neither detection nor clear writes an `application_event`, so the "Date"/statusDate column is unaffected.
- **Migration 0043** is next (0042 = consent_form).
