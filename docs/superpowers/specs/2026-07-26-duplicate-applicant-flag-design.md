# Feature C: Duplicate-applicant flag (name + DOB)

**Date:** 2026-07-26
**Status:** Approved (in-chat; recommended defaults locked in), pending plan

## Problem

A parent may legitimately apply for a second child (siblings, same email) — that is fine. But the same child could be submitted twice (data-entry error, a genuine duplicate, or a re-application). The director wants a NON-BLOCKING flag in the dashboard when a new application's child **name + date of birth** matches an existing application, so they can manually check and either keep or dismiss (clear) the flag. It must never block submission.

## Key facts (from the codebase)

- The parent 2A form collects `childDob` as a required fixed field (`lib/portal/director/application-form.ts:78`), stored in `application_draft.parent_answers` under key `childDob`.
- The application's child name is `application.applicant_name` (from `parent.childName` / split names) — set at submit in `submitStage2` (`packages/app/src/stage2.ts:368`).
- So at submit time BOTH the name (childName) and DOB (`parent.childDob`) are available; existing applications' DOB is reachable via their converted draft's `parent_answers.childDob`.
- `application` has no DOB column; no new data is collected — this reuses already-collected, already-director-visible data for an internal application-processing purpose (chapter-scoped, director-only), consistent with the existing "authorized application-processing use" framing in `ops-read.ts`.
- Ops transitions go through `PATCH /api/ops/applications/:id` with an `action`, handled by `ApplicationService` methods gated on `application.transition` (chapter-scoped `resource`). Next migration number is **0043**.
- A name normalizer already exists: `normalizeGuardianName` in `packages/app/src/config.ts` (NFC + trim + collapse whitespace + lowercase; diacritics preserved). Reused here for the child-name comparison.

## Locked decisions (recommended defaults)

- **Match scope: same chapter only.** Flag only when name+DOB matches another application in the same chapter (consistent with the chapter-scoped dashboard; no cross-chapter read).
- **Prior status: any status, including declined/withdrawn.** Flag against any earlier application with a matching name+DOB regardless of its status (a re-application after a decline is exactly what the director wants to see).
- **Match rule:** `normalizeGuardianName(childName)` equal AND `childDob` string-equal (both come from the same date input, ISO `YYYY-MM-DD`). If the new application has no `childDob` (should not happen — it is required — but defensively), skip detection.
- **Which row is flagged:** the NEW (later) application is flagged, pointing at the earliest matching existing application (`duplicate_of_application_id`). The earlier application is not flagged.
- **Non-blocking + manually clearable:** the flag is metadata stamped after the application is already inserted; a director clears it via an ops action. Clearing is per-application and permanent (a future duplicate flags that future application independently).

## Design

### Schema — migration 0043 (`0043_application_duplicate_flag.sql`) + drizzle mirror

Add to `application`:
- `duplicate_flagged_at timestamptz` (null = never flagged).
- `duplicate_of_application_id uuid references application(id)` (the earlier match; null when not flagged).
- `duplicate_cleared_at timestamptz` (null = not cleared).
- `duplicate_cleared_by uuid references account(id)` (who dismissed it).

"Actively flagged" = `duplicate_flagged_at IS NOT NULL AND duplicate_cleared_at IS NULL`. No backfill of existing applications (flag applies to new submissions going forward; YAGNI).

### Detection at submit — `packages/app/src/stage2.ts` (`submitStage2`)

Inside the existing submit transaction, AFTER the application insert and lead/draft updates, run detection:
1. Read the new child DOB: `parent.childDob` (string). If absent/empty, skip.
2. Query candidate existing applications in the same chapter (excluding the new app) whose converted draft's `parent_answers->>'childDob'` equals the new DOB:
   ```sql
   select a.id, a.applicant_name
   from application a
   join application_draft d on d.converted_application_id = a.id
   where a.chapter_id = ${chapterId} and a.id <> ${newAppId}
     and d.parent_answers->>'childDob' = ${childDob}
   order by a.created_at asc
   ```
3. In JS, find the first candidate whose `normalizeGuardianName(applicant_name)` equals `normalizeGuardianName(childName)`. If found, stamp the new app: `duplicate_flagged_at = now(), duplicate_of_application_id = <candidate id>` (in the same transaction). Detection failure must never break submit — it is inside the tx but is additive; a match simply sets two columns.

Note: DOB filtering in SQL (exact) narrows candidates; name normalization is done in JS to reuse `normalizeGuardianName` (NFC-aware, which SQL `lower()` is not). No `application_event` is written for the flag (a flag is not a status change; writing an event would corrupt the "Date"/statusDate column).

### Clear action — `ApplicationService.clearDuplicateFlag` + controller case

- New method `clearDuplicateFlag(ctx, { applicationId, note })` in `packages/app/src/service.ts`: load the app (id, chapter_id), authorize `application.transition` on the chapter-scoped `resource`, then `update application set duplicate_cleared_at = now(), duplicate_cleared_by = ${ctx.account.id} where id = ${appId}`. No status change, no event (the `duplicate_cleared_at/by` columns are the audit trail; the authorize wrapper records the decision). Idempotent-safe (clearing an already-cleared or unflagged app is a harmless no-op update).
- Add `case 'clear-duplicate-flag': outcome = await svc.clearDuplicateFlag(ctx, tinput); break;` to the `transitionApplication` switch in `packages/http/src/controllers/ops.ts`.

### Surfacing — reads + frontend

- **ops-read list** (`ApplicationListItem`): add `duplicateFlag: boolean` = flagged AND not cleared. Select the two timestamps in the applications query; leads set `duplicateFlag: false`.
- **ops-read detail** (`ApplicationDetail`): add `duplicate: { flagged: boolean; ofApplicationId: string | null; ofApplicantName: string | null; clearedAt: string | null }`. Join the matched application for its `applicant_name` so the banner can name it.
- **data layer** (`lib/portal/director/applications-data.ts`): thread `duplicateFlag` onto `ApplicationRow`; thread the detail `duplicate` object onto `ApplicationDetail`.
- **list page**: on a flagged row, show a small amber "Possible duplicate" badge/dot near the name (does not replace the status badge).
- **detail page**: when `duplicate.flagged`, show an amber banner "Possible duplicate of an existing application" with a link to `ofApplicationId` (labeled with `ofApplicantName`) and a "Clear flag" button (`OpsActionButton`, `PATCH /api/ops/applications/:id`, body `{ action: "clear-duplicate-flag" }`, with a confirm). When cleared, no banner.

## Non-goals / YAGNI

- No cross-chapter matching (chapter-scoped).
- No retroactive backfill of already-submitted applications.
- No auto-merge / auto-decline — advisory flag only, never blocks.
- No fuzzy DOB or fuzzy name matching beyond the existing NFC/case/space normalization (exact DOB, normalized name).
- No re-flag on clear — clearing is final per application.

## Testing

- **Detection** (`packages/app/test/stage2.test.ts` or a focused test): two applications in one chapter with the same normalized child name + same childDob → the second is flagged with `duplicate_of_application_id` = the first; different DOB or different name → not flagged; a match in a DIFFERENT chapter → not flagged; a prior DECLINED match still flags.
- **Clear** (service/ops test): `clearDuplicateFlag` sets cleared_at/by and is gated (a non-director / cross-chapter caller is Forbidden); after clearing, the list `duplicateFlag` is false.
- **ops-read** (`packages/http/test/ops-read.test.ts`): a flagged application surfaces `duplicateFlag: true` in the list and the `duplicate` object in the detail; a cleared one surfaces `false`.
- **Frontend**: verified by running the app (badge on the list, banner + clear button on the detail).

## Coordination note

Touches `packages/app/src/{stage2.ts,service.ts,ops-read.ts}`, `packages/http/src/controllers/ops.ts`, `packages/db/*`, and the director frontend — a busy shared branch (`feat/platform-m1`) with other agents. Confirm each target file is quiet before editing; commit with explicit paths only.
