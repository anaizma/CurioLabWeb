# Application form definition — backend spec / build prompt

**Status:** frontend designer shipped (director portal → Intake → *Application form*); it currently
persists to the director's browser only. This document specs the backend so a director's edits become
the **live** application funnel.

**Audience:** platform/backend agent. Hand this whole file over as the build prompt.

---

## Goal

Let a chapter director edit the questions applicants answer (parent Stage-2A + student Stage-2B), and
have the apply funnel render from that stored definition instead of the hardcoded frontend config.

Today the questions are hardcoded in the frontend:
- Student (2B): `app/apply/funnel.ts` → `STUDENT_QUESTIONS`.
- Parent (2A): `app/apply/parent/[token]/parent-client.tsx` (JSX fields) + `funnel.ts` `PARENT_FIELD_LABELS`.

And the only backend knob is the key allowlist `STAGE2_STUDENT_ALLOWED_FIELDS` in
`packages/app/src/config.ts`. There is **no** stored form definition. This spec adds one.

## Data model

One active form definition **per chapter** (fall back to a platform default when a chapter has none).
Keep prior versions for audit.

```
table application_form
  id              uuid pk
  chapter_id      uuid fk -> chapter (nullable = platform default)
  version         int            -- monotonic per chapter
  status          text           -- 'draft' | 'published'
  definition      jsonb          -- the shape below
  created_by      uuid fk -> account
  created_at      timestamptz
  published_at    timestamptz null
  unique (chapter_id, version)
```

`definition` jsonb — **matches the frontend model** (`lib/portal/director/application-form.ts`) so the
wire format needs no translation:

```jsonc
{
  "version": 3,
  "sections": [
    {
      "id": "parent",            // 'parent' | 'student'
      "title": "Parent / guardian section",
      "description": "…",
      "questions": [
        {
          "id": "p_gradeEntering",
          "key": "gradeEntering",           // machine key -> answers blob
          "label": "Grade entering in the fall",
          "type": "dropdown",               // short_text|long_text|email|phone|date|dropdown|multiple_choice|checkboxes|consent
          "required": true,
          "help": "",
          "options": ["6","7","8","9","10","11","12"],
          "fixed": true                      // system-critical: key/type/required locked, not removable
        }
        // …
      ]
    },
    { "id": "student", "title": "Student questionnaire", "description": "…", "questions": [ /* … */ ] }
  ]
}
```

## Endpoints (HTTP → controllers → app service)

Follow the existing ops pattern (`packages/http/src/controllers/ops-read.ts` + `route-manifest.ts`).

1. `GET /api/ops/application-form` — director reads their chapter's current (published or latest draft)
   definition. Capability `application.read` (chapter-director + admin), chapter-scoped like the other ops
   reads. Response: `{ chapterId, version, status, definition }`, or the platform default when none exists.

2. `PUT /api/ops/application-form` — director saves a new version. New capability
   `application.form.manage` (chapter-director + admin). Body: `{ definition, publish?: boolean }`.
   - Validate (see below), bump `version`, insert row; set `status='published'` + `published_at` when
     `publish` is true, else `'draft'`.
   - Return the stored `{ version, status, definition }`.

3. **Public read for the funnel** — expose the *published* definition to the apply pages. Either extend
   the existing token-scoped `GET /api/public/stage2/*` responses to include the resolved definition for
   the application's chapter, or add `GET /api/public/application-form?token=…`. The apply pages must be
   able to render the questions for the chapter the applicant is applying to **without** an ops session.

## Validation rules (enforce server-side in the app service)

- **Student keys stay on the allowlist.** Every `section.id === 'student'` question `key` must be in
  `STAGE2_STUDENT_ALLOWED_FIELDS`. Reject 400 with the offending keys otherwise — this is the invariant
  that keeps 2B saves from being rejected downstream. (Decide: either the editor is constrained to the
  allowlist, or `PUT` may *extend* the allowlist for that chapter — if the latter, the allowlist itself
  must become chapter-scoped data, not a code constant.)
- **No identifying keys** where disallowed — reuse `STAGE2_IDENTIFYING_KEY_PATTERN`.
- **Fixed fields are immutable in structure.** For every `fixed: true` question in the incoming
  definition, `key`, `type`, and `required` must equal the platform default; only `label`/`help`/option
  wording may change. Reject attempts to remove or restructure them (the platform + enrollment depend on
  `childDob`, `gradeEntering`, `guardianEmail`, the consent booleans, etc.).
- **Keys unique** within a section; non-empty; slug-safe.
- **Choice types** (`dropdown`/`multiple_choice`/`checkboxes`) need ≥1 option.

## Frontend wiring (once endpoints exist)

- `lib/portal/director/application-form.ts` already holds the exact model — replace the localStorage
  load/save in `components/portal/director/ApplicationFormEditor.tsx` with `GET`/`PUT`, and drop the
  "saved to this browser" notice. Add a Draft/Publish control mapping to `publish`.
- The apply funnel reads the published definition:
  - `app/apply/student/[token]/student-client.tsx` — render from `definition.sections['student']`
    instead of importing `STUDENT_QUESTIONS`.
  - `app/apply/parent/[token]/parent-client.tsx` — render from `definition.sections['parent']`
    (the fixed fields keep their current widgets; editable ones render generically by `type`).
- `STUDENT_QUESTIONS` / hardcoded parent JSX become the **seed** for the platform-default row, then can be
  retired.

## Audit

`application.form.manage` writes should land in the audit log (director surface `/portal/director/audit`)
with the version and publish state.
