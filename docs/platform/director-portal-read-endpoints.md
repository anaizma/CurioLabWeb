# Director portal — read endpoints the frontend needs (backend request)

Date: 2026-07-23
Audience: the backend agent on `feat/platform-m1`
Context: The director portal (`/portal/director/*`, spec `docs/superpowers/specs/2026-07-23-director-portal-design.md`) is being built now. Its **write** paths use the existing ops mutations in `api-reference.md` §6. Its **read** surfaces currently have no list/detail GETs — per `api-reference.md`, only `GET /api/lab/moderation/queue` and `GET /api/ops/audit` exist; every other ops surface is POST-only.

The frontend ships today against representative fallback data and flips each surface to live data the moment its GET below exists — **no frontend change needed** once these land, as long as the response shapes match. Shapes below are proposals; if you implement differently, tell me the field names and I'll map them.

## Conventions (apply to all)

- **Auth:** `session`, chapter-scoped to the Chapter Director (platform_admin via override) — same scoping as the matching §6 mutation. Reuse the mutation's capability family as the read capability (e.g. `application.transition` → `application.read`, or gate reads on any chapter-director membership).
- **Scope:** results limited to the caller's director chapter. No cross-chapter leakage.
- **Shape:** `200 { items: [...] }` for lists (a bare envelope so pagination can be added later without a breaking change); `200 { ... }` for a single detail. `401` no session; `403` not a director.
- **Filtering:** where noted, accept `?status=` (repeatable/CSV) to filter; default = all non-terminal.
- **No PII beyond what the surface must show.** Minors' last names/schools stay hidden per the platform rules; return display names and ids, not raw identifying fields, unless the surface legitimately needs them (e.g. guardianship name-match).

## Endpoints requested (priority order)

### 1. `GET /api/ops/applications` — list + `GET /api/ops/applications/{id}` — detail

Powers the Applications review surface (transitions already exist at `PATCH /api/ops/applications/{id}`).

- **List** `?status=submitted|screening|interview|accepted|declined|withdrawn` (repeatable). Response:
  `{ items: [{ applicationId, status, studentDisplayName, guardianDisplayName, submittedAt, chapterId, term?: string }] }`
- **Detail** `{id}`:
  `{ applicationId, status, submittedAt, student: { displayName, ageBand? }, guardian: { displayName, email? }, answers: { stage2a: {...}, stage2b: {...}, stage2c?: {...} }, history: [{ from, to, at, note? }] }`
  (Whatever the funnel captured — the detail view renders the 2A/2B/2C answers read-only for the review decision.)

### 2. `GET /api/ops/invites` — list

Powers the Invites surface's pending list (issue + resend already exist at `POST /api/ops/invites` and `…/{id}/resend`).

`{ items: [{ inviteId, kind, targetEmail: string|null, status: "pending"|"accepted"|"expired"|"superseded", issuedAt, expiresAt, acceptedAccountId?: string|null }] }`

The raw token must **not** be returned here (it's shown once at issue/resend). A resend flow re-mints and returns the token via the existing POST.

### 3. `GET /api/ops/memberships` — roster

Powers the Members surface (activate already exists at `POST /api/ops/memberships/{id}/activate`).

`{ items: [{ membershipId, accountId, displayName, role, status: "pending"|"active"|"suspended"|"lapsed", tier: string|null, podId: string|null, joinedAt }] }`
`?status=` and `?role=` filters welcome.

### 4. `GET /api/ops/guardianships` — list

Powers the Guardianships surface (verify/revoke already exist at `POST …/{id}/verify` / `revoke`). The verify decision is a name-on-account vs name-on-form match, so this surface **does** need both names.

`{ items: [{ guardianshipId, status: "pending"|"verified"|"rejected"|"revoked", guardianDisplayName, guardianNameOnAccount, studentDisplayName, nameOnForm, createdAt }] }`

### 5. `GET /api/ops/media/review-queue` — list

Powers the Media surface (confirm-depiction/clear/remove already exist).

`{ items: [{ mediaId, projectId, projectTitle, reviewStatus, storageRef, depictions: [{ accountId, displayName, confirmed: boolean }], flaggedReason?: string, submittedAt }] }`

### 6. `GET /api/ops/deletion-requests` + `GET /api/ops/export-requests` — lists

Power the Requests surface (review/fulfill already exist).

- Deletion: `{ items: [{ deletionRequestId, subjectAccountId, subjectDisplayName, status, requestedAt }] }`
- Export: `{ items: [{ exportRequestId, subjectAccountId, subjectDisplayName, status, requestedAt }] }`

### 7. `GET /api/ops/enrollments` — list

Powers the Enrollments surface (create already exists at `POST /api/ops/enrollments`).

`{ items: [{ enrollmentRecordId, applicationId, studentDisplayName, termId, termName?, guardianNameOnForm, signatureDate, hasAccount: boolean }] }`

### 8. `GET /api/ops/pods` + `GET /api/ops/terms` — lists

Power the Pods & terms surface (create/patch/assign already exist).

- Pods: `{ items: [{ podId, name, termId, mentorMembershipId: string|null, mentorDisplayName?: string|null, memberCount: number }] }`
- Terms: `{ items: [{ termId, name, startsOn, endsOn }] }`

### 9. *(nice-to-have)* `GET /api/ops/dashboard` — chapter summary

Powers the Dashboard's count cards. If skipped, the frontend derives counts from the lists above once they exist.

`{ newApplications: number, pendingInvites: number, guardianshipsToVerify: number, mediaToReview: number, openRequests: number, activeMembers: number }`

## Already live (no work needed)

- `GET /api/lab/moderation/queue` → Moderation surface (wired live now).
- `GET /api/ops/audit` → Audit surface (wired live now).
- All §6 mutations the write actions depend on already exist.

## Coordination

Ping me with the actual response shapes when any of these land (even one at a time) and I'll wire that surface from fallback to live in a single small change. If a field name or envelope differs from the proposal above, that's fine — just tell me the real shape.
