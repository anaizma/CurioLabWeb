# My Information (account self-service) — backend spec / build prompt

**Status:** frontend shipped — Settings → *My Information* in all three portals (student, parent, director).
**Done:** the student email pair is now LIVE via `GET`/`PUT /api/portal/student/notification-email`
(the frontend `EmailSection` reads/writes it, honoring `primary.editable`/`isOwn` and the under-13 freeze).
**Still representative (this spec):** name, DOB, school/grade, guardian info, and the parent/director email —
they need the `GET`/`PUT /api/account` endpoints below.

## Goal

Let a member read the info CurioLab collects about them, and edit the few fields that are editable:
- **email** (all roles),
- **school** (students only).

Everything else is read-only. The **under-13 email freeze** must be enforced server-side.

## 1. `GET /api/account` — read my own info

Self-scoped read for the current `ctx.account.id`. Returns the fields the portal displays:

```jsonc
{
  "role": "student" | "guardian" | "chapter_director" | ...,
  "fullName": "…",            // account.legal_name / display_name
  "dateOfBirth": "2013-09-14",// account.date_of_birth (student)
  "age": 12,                   // computed (same ageInYears helper as session)
  "primaryEmail": "…|null",    // account.email (null for minors on username identity)
  "secondaryEmail": "…|null",  // account.notification_email
  "school": "…|null",          // student: application_draft.parent_answers.schoolName
  "grade": "…|null",           // student: parent_answers.gradeEntering
  "phone": "…|null",           // guardian: funnel answer (no column today)
  "guardian": { "name": "…", "email": "…" },   // student only
  "children": [{ "name": "…" }],               // guardian only
  "chapter": "…", "roleLabel": "…",            // director
  // The freeze signal the UI needs:
  "emailEditable": true,       // false when role=student AND age < 13
  "emailFrozenTo": "guardian@…"// when frozen, the guardian email shown in the locked field
}
```

Only expose the requesting member's OWN row. Minor PII rules still apply for staff reads elsewhere — this
endpoint is self-only.

## 2. `PATCH /api/account` — update editable fields

Body: `{ email?: string, school?: string }`. Server-side rules (do NOT trust the client):

- **email**: reject unless the field is editable for this member.
  - Student **under 13** → **reject** (`403`/`409`); their contactability runs through the guardian
    (reuse the existing `StudentNotificationEmailAgeError` / age-floor logic). The primary email stays
    frozen to the guardian's address.
  - Student **13+**, guardian, director → allowed. Validate format; keep the existing coming-of-age
    (`maturation`) path distinct from a plain email change.
- **school** (students only): update `application_draft.parent_answers.schoolName` (or a new column if
  school graduates to first-class). Reject school edits for non-students.
- Everything else in the body is ignored/rejected — no other field is editable.

New capability e.g. `account.self.manage`; audit the change.

## Frontend wiring (once endpoints exist)

- `lib/portal/settings/my-info-data.ts` — replace the representative builders with a `GET /api/account`
  read; map `emailEditable`/`emailFrozenTo` straight onto the existing `InfoField.editable`/`frozen`.
- `components/portal/settings/MyInformation.tsx` — point the per-field Save at `PATCH /api/account`
  (currently optimistic local state) and drop the "example data" notice.

The frontend already models the exact shape (roles, editable/frozen fields, under-13 freeze), so wiring is
a read/write swap, not a redesign.
