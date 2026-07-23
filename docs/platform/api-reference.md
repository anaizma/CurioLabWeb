# CurioLab Platform API Reference

A practical, front-end-facing reference for the CurioLab platform backend. Generated from the actual code: the controllers in `packages/http/src/controllers/*.ts`, the Next route adapters under `app/api/**/route.ts`, `run.ts` / `respond.ts` / `context.ts`, `packages/core/src/registry.ts`, and the service result types in `packages/app/src`.

Every request field and response shape below is taken from the controller (request fields from its `reqStr` / `optStr` / `reqObj` reads; response shapes from the service result type it returns). Where a shape is a placeholder or a service method is missing, it is called out inline.

---

## How auth works

- **Session cookie.** Authenticated endpoints read an opaque session token from the cookie **`cl_session`** (constant `SESSION_COOKIE`). `POST /api/auth/login` sets it (httpOnly, sameSite=lax, secure, path=`/`, 30-day expiry); `POST /api/auth/logout` and `DELETE /api/auth/impersonate` clear it. The raw token is never stored server-side — only its hash.
- **`runAuthed` vs `runPublic`.** Authed controllers resolve the cookie to an `AuthContext` (`context.ts`). A missing / unknown / expired / revoked session resolves to a **null context**, which becomes an **opaque `403 {"error":"forbidden"}` with no audit** (there is no actor to attribute). Public / token-gated controllers take no `AuthContext`.
- **Opaque 403.** A denied capability (`Forbidden`) and a null session both return the identical `403 {"error":"forbidden"}` body — "not allowed", "out of scope", and "does not exist" are deliberately indistinguishable from outside. Do not branch on 403 sub-reasons; there are none.
- **Capabilities.** Each authed endpoint names the registry capability its service authorizes (`registry.ts`). Chapter-scoped capabilities require an in-force membership of the listed role in the resource's chapter; `platform`-scoped ones are reachable only via the platform override (`platform_admin`, or `platform_staff` for read-only capabilities).
- **Unauthenticated / token-gated routes** (no `cl_session` needed): the Apply funnel (`/api/apply`, `/api/public/stage2/*`), `POST /api/auth/login`, `POST /api/auth/password/reset-request`, `POST /api/auth/password/reset`, `POST /api/auth/account-recovery`, all `/api/invites/[token]*`, `GET /api/verify/[token]`, all `/api/public/**` reads and newsletter subscribe/confirm/unsubscribe, and both `/api/webhooks/*`. These carry their own gate (an opaque token or a webhook signature), not a session.

### Legend

`METHOD /path` · **Auth**: `public` = no cookie · `session` = requires `cl_session` (capability named) · `token` = gated by an opaque token in the body/path. Path params in `{braces}`. Bodies are JSON. Error statuses list only the notable ones; a null session on any `session` route is always `403`.

### Error → status map (`respond.ts`)

| Status | Meaning | Body |
|---|---|---|
| `400` | validation / precondition (`ValidationError`, missing `reqStr`/`reqObj` field, unknown enum value, and the listed input errors) | `{"error":"invalid_request"}` |
| `401` | opaque token failure (Stage-2, invite, subscriber, credential tokens); also the auth-specific `unauthorized` body | `{"error":"invalid_token"}` (or `{"error":"unauthorized"}` for login/session) |
| `403` | denied capability, policy refusal (`MaturationNotSelfError`, `MaturationAgeError`), or null session | `{"error":"forbidden"}` |
| `404` | named resource not found (the `*NotFoundError` set) | `{"error":"not_found"}` |
| `409` | illegal state-machine edge / phase conflict (`Illegal*TransitionError`, `Stage2*`, consent-changed, media-not-clearable, reissue-against-active) | `{"error":"conflict"}` |
| `500` | genuinely unknown thrown error (re-thrown, not masked) | framework default |

> **Note on `contact`.** `app/api/contact/route.ts` exists but is a standalone marketing contact form (calls Resend directly, imports no platform controller). It is **not** part of the platform backend and is excluded here.

---

## 1. Apply funnel (public)

The Stage-1 lead capture (`/api/apply`, owned by the frontend) then the token-gated Stage-2 chain. Parent flow: **start → parent → student-link → (child) student → review → submit**, with **send-back** to bounce 2C back to 2B.

### `POST /api/apply` — create a lead *(frontend-owned; snippet below)*

- **Auth:** public, inert. No route committed in this repo — the frontend owns the path. Backed by `LeadService.createLead` (`packages/app/src/lead.ts`).
- **Request body:**
  - `email` (string, required) — parent email; the only Stage-1 contact datum.
  - `chapter` (string, required) — chapter **code/slug** (may be "another school", which stays unmapped).
  - `source` (string, optional) — "how did you hear".
  - `fillerRole` (`"parent" | "student"`, required) — drives confirmation copy.
- **Response `201`** (recommended, per the snippet): `{ leadId: string, suppressed: boolean }`. `suppressed:true` means an in-window duplicate email matched and no new row was written (still returns the existing `leadId`).
- **Behavior:** creates exactly one `application_lead` (status `new`), issues a hashed Stage-2 token (stored as hash; not returned), stamps `expires_at = created_at + 30d`. Creates no account and no application. Dedupe window and expiry are config tunables. Rate-limiting / bot checks are the HTTP layer's job (not in the service).

**Ready-to-paste `app/api/apply/route.ts`** (mirrors the `/api/public/stage2/*` adapter pattern; uniform JSON response). Placing this file is the frontend's call:

```ts
// POST /api/apply — Stage 1 lead capture (frontend-owned surface).
// Thin adapter: parse the body, call LeadService.createLead with the shared
// db client, return the created lead id as a uniform JSON Response.
import { getSql } from '@curiolab/http'
import { LeadService } from '@curiolab/app'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const email = typeof body.email === 'string' ? body.email : ''
  const chapter = typeof body.chapter === 'string' ? body.chapter : ''
  const source = typeof body.source === 'string' ? body.source : null
  const fillerRole = body.fillerRole === 'student' ? 'student' : 'parent'

  const result = await new LeadService({ sql: getSql() }).createLead({
    email,
    chapter,
    source,
    fillerRole,
  })
  return Response.json({ leadId: result.leadId, suppressed: result.suppressed }, { status: 201 })
}
```

> `LeadService.createLead` does not itself validate `email`/`chapter` presence — add the input guards you want in the adapter (the snippet coerces defensively). The service is safe to call with no `AuthContext`.

### `POST /api/public/stage2/start` — consume lead token, create draft

- **Auth:** token (**parent/lead token**). Phase: creates the draft at phase `2a`.
- **Request body:** `token` (string, required) — the lead's Stage-2 token.
- **Response `201`:** `{ draftId: string, leadId: string }`.
- **Errors:** `400` missing `token`; `401` unknown/mismatched token (`InvalidStage2TokenError`); `409` lead already started/converted (`Stage2AlreadyStartedError`).

### `POST /api/public/stage2/parent` — save 2A parent section

- **Auth:** token (**parent token**). Phase: `2a`. Saves only; does **not** mint the student token.
- **Request body:** `token` (string, required); `answers` (object, required) — free-form 2A facts blob.
- **Response `200`:** `{ saved: true }`.
- **Errors:** `400` missing `token`/`answers`; `401` invalid token; `409` wrong phase (`Stage2NotInPhaseError`).

### `POST /api/public/stage2/student-link` — mint/re-mint 2B student link

- **Auth:** token (**parent token**). Phase: after 2A.
- **Request body:** `token` (string, required) — parent token.
- **Response `200`:** `{ studentToken: string }` — the opaque **student** token, returned raw once; each call regenerates it and supersedes the prior one.
- **Errors:** `400` missing `token`; `401` invalid token; `409` wrong phase.

### `POST /api/public/stage2/student` — save 2B student section

- **Auth:** token (**student token**). Phase: `2b`. Saves; does not submit.
- **Request body:** `token` (string, required) — student token; `answers` (object, required) — 2B answers (an allowlist governs which fields are accepted; identifying fields are rejected `400`).
- **Response `200`:** `{ saved: true }`.
- **Errors:** `400` missing fields, or a disallowed / identifying student field (`StudentSectionFieldNotAllowedError`, `StudentSectionIdentifyingFieldError`); `401` invalid token; `409` wrong phase.

### `POST /api/public/stage2/review` — read-only 2C view

- **Auth:** token (**parent token**). Phase: 2C.
- **Request body:** `token` (string, required) — parent token.
- **Response `200`:** `{ phase: string, status: string, parentAnswers: object|null, studentAnswers: object|null }` (student answers are read-only to the parent).
- **Errors:** `400` missing `token`; `401` invalid token.

### `POST /api/public/stage2/submit` — submit 2C, mint the application

- **Auth:** token (**parent token only**). Phase: 2C.
- **Request body:** `token` (string, required) — parent token.
- **Response `201`:** `{ applicationId: string, leadId: string }`.
- **Errors:** `400` missing `token` or incomplete parent facts (`Stage2ParentFactsIncompleteError`) / missing lead chapter (`Stage2LeadChapterRequiredError`); `401` invalid token; `409` wrong phase.

### `POST /api/public/stage2/send-back` — bounce 2C → 2B

- **Auth:** token (**parent token**). Phase: 2C → 2B.
- **Request body:** `token` (string, required) — parent token.
- **Response `200`:** `{ sentBack: true }`.
- **Errors:** `400` missing `token`; `401` invalid token; `409` wrong phase.

---

## 2. Auth & onboarding

### `POST /api/auth/login`

- **Auth:** public. Sets `cl_session` on success (adapter writes the cookie).
- **Request body:** `identifier` (string, required — email **or** username, case-insensitive); `password` (string, required).
- **Response `200`:** `{ accountId: string }` (+ `Set-Cookie: cl_session`).
- **Errors:** `400` missing field; `401 {"error":"unauthorized"}` for **any** failure (unknown account, no password set, closed/suspended, or bad password — uniform, no enumeration).

### `POST /api/auth/logout`

- **Auth:** session cookie read directly (no capability); idempotent.
- **Request:** none. Reads `cl_session`.
- **Response `200`:** `{ loggedOut: true }` (+ clears the cookie). Safe even with no live session.

### `GET /api/auth/session`

- **Auth:** session cookie read directly (no capability).
- **Request:** none.
- **Response `200`:** `{ accountId, status, age, maturationState, memberships: [{ chapterId, role, status, podId, tier }], guardianOf: string[], impersonating: boolean }`.
- **Errors:** `401 {"error":"unauthorized"}` when there is no live session (note: this route returns 401, not the opaque 403, because it is a public controller reading the session summary).

### `POST /api/auth/password/reset-request`

- **Auth:** public. Uniform response, no account-existence oracle.
- **Request body:** `identifier` (string, required — email or username).
- **Response `202`:** `{ requested: true }` — byte-identical whether or not the identifier resolves. On a resolving identifier a reset token is persisted and a delivery route computed (adult → own email; minor → verified guardians, or the Chapter Director for a `self_private` account); actual send is a deferred mailer seam.
- **Errors:** `400` missing `identifier`.

### `POST /api/auth/password/reset`

- **Auth:** token (credential reset token), public.
- **Request body:** `token` (string, required); `newPassword` (string, required).
- **Response `200`:** `{ reset: true }`. Sets the argon2id password, marks the token consumed, revokes prior sessions.
- **Errors:** `400` missing field; `401` expired/consumed/unknown token (`InvalidCredentialTokenError`).

### `POST /api/auth/email/add`

- **Auth:** session. **Self-initiated**, gated by self-ownership + an 18+ age floor **inside the service** (no registry capability).
- **Request body:** `email` (string, required).
- **Response `200`:** `{ accountId, email, maturationState: "maturation_pending" }` (a minor-owned credential converting toward self-management).
- **Errors:** `400` missing `email`; `403` self/age policy refusal (`MaturationNotSelfError`, `MaturationAgeError`) or null session.

### `POST /api/auth/impersonate`

- **Auth:** session — capability **`impersonation.start`** (scope `platform`, `platform_admin` only; `platform_staff` is denied). Sets `cl_session` to the impersonation token.
- **Request body:** `targetAccountId` (string, required).
- **Response `200`:** `{ impersonatedAccountId, mode, expiresAt }` (+ `Set-Cookie`). 30-minute session; read-only when the target is a minor (enforced by `createImpersonationSession`).
- **Errors:** `400` missing `targetAccountId`; `403` non-admin / null session; `404` unknown target account.

### `DELETE /api/auth/impersonate`

- **Auth:** session cookie read directly; idempotent.
- **Request:** none.
- **Response `200`:** `{ ended: true }` (+ clears the cookie). Revokes the impersonation session row when present.

### `POST /api/auth/account-recovery`

- **Auth:** token (account_recovery setup token minted by `reissue-setup`), public.
- **Request body:** `token` (string, required); `email` (string, required); `newPassword` (string, required).
- **Response `200`:** `{ accountId, email }`. Sets email + a fresh password for a locked-out adult former student and consumes the token.
- **Errors:** `400` missing field; `401` expired/consumed/unknown token (`InvalidCredentialTokenError`).

### `GET /api/invites/{token}` — validate an invite

- **Auth:** token (invite token), public; timing-safe uniform response.
- **Path param:** `token`.
- **Response `200`:** `{ usable: boolean, kind: "guardian"|"student"|"mentor"|"staff"|null, chapter: string|null }` (uniform shape; a not-usable token returns `{usable:false, kind:null, chapter:null}`, never an error).

### `POST /api/invites/{token}/accept` — email path (guardian / mentor / staff)

- **Auth:** token (invite token), public, inert — creates only a `pending` account (and a `pending` guardianship edge for a guardian invite).
- **Path param:** `token`. **Request body:** `email`, `password`, `legalName`, `displayName`, `dateOfBirth` (ISO `YYYY-MM-DD`) — all required strings.
- **Response `201`:** `{ accountId: string, guardianshipId: string|null }` (edge id present only for a guardian invite).
- **Errors:** `400` missing field or credential/email mismatch (`InviteCredentialMismatchError`, `GuardianInviteEmailMismatchError`); `401` invalid invite (`InvalidInviteError`); `404` unknown invite (`InviteNotFoundError`).

### `POST /api/invites/{token}/accept-student` — username path (guardian-mediated)

- **Auth:** token (invite token), public, inert.
- **Path param:** `token`. **Request body:** `username`, `password`, `legalName`, `displayName` (required strings). `dateOfBirth` is **ignored** — the canonical DOB is copied from the bound enrollment record.
- **Response `201`:** `{ accountId: string, guardianshipId: string|null }`.
- **Errors:** as `accept` above.

---

## 3. Guardian portal

Every method is **guardian-scoped**: the resource names the child, and the scope matches only the acting guardian's own **verified minor** children (a different guardian, a lapsed edge, or an 18+ child → opaque `403`).

### `GET /api/guardian/children/{id}/record`

- **Auth:** session — **`guardian.view_child_record`** (logs a read).
- **Path param:** `id` (child account id).
- **Response `200`:** `{ childId, memberships: [{ role, status, chapterId, currentTier }], currentTier: string|null, mentorHours: number|null, timeline: [], consents: { <consentType>: boolean } }`. `mentorHours`/`timeline` are honest placeholders (M2/M3).

### `GET /api/guardian/children/{id}/fees`

- **Auth:** session — **`guardian.view_fee_status`**.
- **Path param:** `id`.
- **Response `200`:** `{ paymentStatus: "none"|"active"|"past_due"|"waived", tierPaidFor: string|null, scholarships: [{ percentage, note }] }`. Never an amount.

### `POST /api/guardian/children/{id}/consents` — grant a consent

- **Auth:** session — **`consent.grant`**.
- **Path param:** `id`. **Request body:** `type` (required; one of `enrollment`, `data_collection`, `platform_participation`, `public_profile`, `photo_media`, `external_publication`); `scopeRef` (string, optional).
- **Response `201`:** `{ consentId, studentAccountId, type, action: "grant" }`.
- **Errors:** `400` missing/unknown `type`, or `ConsentNotDigitallyGrantableError` / `ConsentScopeRefRequiredError`; `403` scope deny / null session.

### `POST /api/guardian/children/{id}/consents/{type}/revoke` — revoke a consent

- **Auth:** session — **`consent.revoke`**. Fires the composed revoke cascades (project external-publication de-list, photo-media → pending_review) in the same transaction.
- **Path params:** `id`, `type` (same consent-type set).
- **Response `200`:** `{ consentId, studentAccountId, type, action: "revoke" }`.
- **Errors:** `400` unknown `type`; `403` scope deny / null session.

### `POST /api/guardian/children/{id}/export`

- **Auth:** session — **`guardian.request_export`**.
- **Path param:** `id`.
- **Response `201`:** `{ exportRequestId, subjectAccountId, status: "requested" }`.

### `POST /api/guardian/children/{id}/deletion`

- **Auth:** session — **`guardian.request_deletion`**.
- **Path param:** `id`. **Request body:** `scope` (required; `"full" | "redaction"`).
- **Response `201`:** `{ deletionRequestId, subjectAccountId, scopeRequested, status: "requested" }`.
- **Errors:** `400` missing/unknown `scope` (`DeletionReasonRequiredError` where applicable); `403` scope deny / null session.

### `GET /api/guardian/digest`

- **Auth:** session — **`guardian.view_digest`**.
- **Request:** none.
- **Response `200`:** `{ chapterId, generatedAt, items: [] }` (non-child-specific; `items` is a placeholder, never the feed).

---

## 4. Student profile & projects

### `GET /api/profile/{id}`

- **Auth:** session — **`profile.view`** (own) or **`student.view_record`** (teaching staff; logs an out-of-pod minor read).
- **Path param:** `id` (subject account id).
- **Response `200`:** `{ subjectAccountId, displayName, tier: string|null, membership: object|null, projects: [{...}], timeline: [{...}], mentorHours: number, narrative: { narrativeId, body } | null }`. Only the **published** narrative surfaces; all sections are present as honest zero-states. `mentorHours` is a placeholder zero.

### `PATCH /api/profile/narrative`

- **Auth:** session — **`profile.edit_narrative`** (own; subject is the actor).
- **Request body:** `body` (string, required).
- **Response `200`:** `{ narrativeId, accountId, status: "pending_review" | "published" }` — a minor's edit lands `pending_review`, an adult's `published`.
- **Errors:** `400` missing `body`; `403` null session / not a student.

### `POST /api/profile/narrative/{id}/review`

- **Auth:** session — **`narrative.review`** (`lead_instructor` / `chapter_director`).
- **Path param:** `id` (narrative id).
- **Response `200`:** `{ narrativeId, accountId, status: "published" | "removed" }`.
- **Errors:** `403` deny; `404` `NarrativeNotFoundError`; `409` illegal narrative edge (`IllegalNarrativeTransitionError`).

### `POST /api/profile/verification-token`

- **Auth:** session — **`verification.regenerate`** (own, or guardian for their child).
- **Request body:** `subjectAccountId` (string, optional — defaults to the actor).
- **Response `201`:** `{ subjectAccountId, tokenId, token }` — the plaintext token returned **once** (only the hash is stored); revokes the prior live token.

### `POST /api/projects`

- **Auth:** session — **`project.create`** (`student` own, or teaching in the chapter).
- **Request body:** `chapterId` (required), `ownerMembershipId` (required), `title` (required), `summary` (string, optional).
- **Response `201`:** `{ projectId, status }` (opens a `draft`).
- **Errors:** `400` missing field; `403` deny.

### `PATCH /api/projects/{id}/submit`

- **Auth:** session — **`project.submit`** (own, `student`).
- **Path param:** `id`.
- **Response `200`:** `{ projectId, status }` (`draft → submitted`).
- **Errors:** `403` deny; `404` `ProjectNotFoundError`; `409` `IllegalProjectTransitionError`.

### `POST /api/projects/{id}/verify`

- **Auth:** session — **`project.verify`** (teaching in pod/chapter).
- **Path param:** `id`.
- **Response `200`:** `{ projectId, status }` (`submitted → verified`).
- **Errors:** `403`/`404`/`409` as above.

### `POST /api/projects/{id}/publish`

- **Auth:** session — **`project.publish_public`** (`chapter_director`; runs the per-item `external_publication` subject-consent gate).
- **Path param:** `id`.
- **Response `200`:** `{ projectId, status }` (`verified → public_listed`).
- **Errors:** `403` deny (incl. missing subject consent); `404`; `409`.

### `POST /api/projects/{id}/unpublish`

- **Auth:** session — **`project.unpublish`** (`chapter_director`).
- **Path param:** `id`.
- **Response `200`:** `{ projectId, status }` (`public_listed → verified`).
- **Errors:** `403`/`404`/`409`.

### `GET /api/verify/{token}` — public verified record

- **Auth:** token (verification token), **public**. Always answers `200` (a status code must not leak existence).
- **Path param:** `token`.
- **Response `200`:** one of
  - shared: `{ shared: true, noindex: true, record: { displayName, tierReached: string|null, projects: [{ title, verifiedAt }], mentorHours } }`
  - not shared: `{ shared: false, noindex: true, notice: "This record is not currently shared." }` — the identical neutral response for an unknown token, a revoked token, and an inactive-`public_profile` subject alike.

---

## 5. The Lab

Minor participants need `platform_participation` consent (enforced in the registry/services). All are `session`.

### `GET /api/lab/feed`

- **Auth:** session — **`feed.view`**.
- **Query params:** `chapterId` (required); `podId`, `type`, `authorMembershipId` (optional); `limit`, `offset` (optional ints); `includeHidden` (`"true"`/`"1"`; requires `feed.moderate`).
- **Response `200`:** `{ posts: [{ postId, chapterId, podId, authorMembershipId, type, body, status, systemGenerated, createdAt, commentCount, reactionCount }], limit, offset }`.
- **Errors:** `400` missing `chapterId`; `403` deny / null session.

### `POST /api/lab/posts`

- **Auth:** session — **`feed.post`**.
- **Request body:** `chapterId` (required); `type` (required; one of `wip`, `finished_project`, `question`, `session_recap` — `milestone`/unknown → `400`); `body` (required); `podId` (optional).
- **Response `201`:** `{ postId, status, authorMembershipId }`.
- **Errors:** `400` missing/invalid `type` or missing field, `PostMilestoneForbiddenError`; `403` deny.

### `PATCH /api/lab/posts/{id}` — edit own post

- **Auth:** session — **`feed.post`** (own).
- **Path param:** `id`. **Request body:** `body` (string, required).
- **Response `200`:** `{ postId, body }`.
- **Errors:** `400` missing `body`; `403`; `404` `PostNotFoundError`.

### `POST /api/lab/posts/{id}/remove`

- **Auth:** session — **`feed.moderate`**. Blanks the body.
- **Path param:** `id`.
- **Response `200`:** `{ id, status, body }`.
- **Errors:** `403`; `404`; `409` `IllegalFeedContentTransitionError`.

### `POST /api/lab/posts/{id}/hide`

- **Auth:** session — **`feed.moderate`** (default) or **`feed.hide_safety`** (with `safety:true`).
- **Path param:** `id`. **Request body (optional):** `safety` (boolean — `true` → on-sight safety hide, hides + auto-files a `class=safety` report atomically); `reason` (optional moderation reason, only with `safety:true`; must be a valid reason).
- **Response `200`:** default → `{ id, status, body }`; safety → `{ id, status: "hidden", reportId }`.
- **Errors:** `400` invalid `reason`; `403`; `404`; `409`.

### `POST /api/lab/posts/{id}/comments`

- **Auth:** session — **`feed.comment`**.
- **Path param:** `id` (post id). **Request body:** `body` (string, required).
- **Response `201`:** `{ commentId, status, authorMembershipId }`.
- **Errors:** `400` missing `body`; `403`; `404`.

### `POST /api/lab/posts/{id}/reactions` and `POST /api/lab/comments/{id}/reactions`

- **Auth:** session — **`feed.react`**.
- **Path param:** `id` (post or comment id per route). **Request body:** `kind` (string, required — the reaction kind).
- **Response `201`:** `{ reactionId, membershipId }`.
- **Errors:** `400` missing `kind`; `403`; `404`.

### `DELETE /api/lab/posts/{id}/reactions` and `DELETE /api/lab/comments/{id}/reactions`

- **Auth:** session — **`feed.react`**.
- **Path param:** `id`. **Request body:** `kind` (string, required).
- **Response `200`:** `{ removed: boolean }`.
- **Errors:** `400` missing `kind`; `403`; `404`.

### `POST /api/lab/reports`

- **Auth:** session — **`feed.report`**.
- **Request body:** `targetType` (required; `"post"|"comment"`); `targetId` (required); `class` (required; `"safety"|"ordinary"`); `reason` (required; one of `harmful`, `sexual`, `threatening`, `self_harm_disclosure`, `off_topic`, `unkind`, `spam`, `quality`); `note` (string, optional).
- **Response `201`:** `{ reportId, status: "filed", class, dueAt }`.
- **Errors:** `400` missing/invalid `targetType`/`class`/`reason`; `403`; `404`.

### `GET /api/lab/moderation/queue`

- **Auth:** session — **`feed.moderate`** (authorized against the chapter, then a direct read; no service read method exists).
- **Query params:** `chapterId` (required).
- **Response `200`:** `{ reports: [{ reportId, targetType, targetId, class, reason, dueAt, filedAt, acknowledgedAt: Date|null, escalatedAt: Date|null }] }` — unresolved reports ordered by `due_at` ascending.
- **Errors:** `400` missing `chapterId`; `403` deny.

### `POST /api/lab/moderation/{id}/ack`

- **Auth:** session — **`feed.moderate`**.
- **Path param:** `id` (report id).
- **Response `200`:** `{ reportId, status: "acknowledged" }`.
- **Errors:** `403`; `404` `ModerationReportNotFoundError`; `409` `IllegalModerationTransitionError`.

### `POST /api/lab/moderation/{id}/resolve`

- **Auth:** session — **`moderation.resolve`** (requires age ≥ 18).
- **Path param:** `id`. **Request body:** `action` (required; one of `none`, `hidden`, `removed`, `dismissed`, `escalated`).
- **Response `200`:** `{ reportId, status: "resolved", actionTaken, slaMet: boolean }`.
- **Errors:** `400` missing/invalid `action`; `403` (incl. a minor); `404`; `409`.

### `POST /api/lab/moderation/{id}/escalate`

- **Auth:** session — **`feed.moderate`**.
- **Path param:** `id`.
- **Response `200`:** `{ reportId, status: "escalated", escalatedTo: string|null }`.
- **Errors:** `403`; `404`; `409`.

---

## 6. Operations (staff)

All `session`, chapter-scoped to the Chapter Director (platform_admin via override) unless noted.

### `PATCH /api/ops/applications/{id}`

- **Auth:** session — **`application.transition`**.
- **Path param:** `id` (application id). **Request body:** `action` (required; one of `screen`, `schedule-interview` (alias `scheduleInterview`), `accept`, `decline`, `withdraw`, `reopen`); `note` (string, optional).
- **Response:** for `reopen` → `201 { applicationId, reopenedFromId }`; for the other actions → `200 { applicationId, from, to }`.
- **Errors:** `400` missing/unknown `action`; `403`; `404` `ApplicationNotFoundError`; `409` `IllegalTransitionError`.

### `POST /api/ops/enrollments`

- **Auth:** session — **`enrollment.create`**. (coupling D)
- **Request body:** `applicationId` (required); `studentAccountId` (optional — absent in the seeding case); `dateOfBirth` (optional string); `chapterId` (required); `termId` (required); `guardianNameOnForm` (required); `signatureDate` (required — parsed as a Date); `signedForm` (required object → `{ body (required), contentType?, key? }`).
- **Response `201`:** `{ enrollmentRecordId, signedFormRef, consentIds: { <formSourcedConsentType>: string } }` (`consentIds` is **empty** in the seeding case — the account does not exist yet).
- **Errors:** `400` missing field / `EnrollmentDobRequiredError`; `403`.

### `POST /api/ops/invites`

- **Auth:** session — **`member.invite`** (`chapter_director` or `comms_associate`).
- **Request body:** `kind` (required; one of `guardian`, `student`, `mentor`, `staff`); `chapterId` (required); `targetEmail` (optional); `enrollmentRecordId` (optional); `intendedAccountId` (optional).
- **Response `201`:** `{ inviteId, token, expiresAt }` — the raw token returned once (only its hash is stored).
- **Errors:** `400` missing/unknown `kind`; `403`.

### `POST /api/ops/invites/{id}/resend`

- **Auth:** session — **`member.invite`**. Supersedes + reissues.
- **Path param:** `id` (invite id).
- **Response `201`:** `{ inviteId, token, expiresAt }`.
- **Errors:** `403`; `404` `InviteNotFoundError`.

### `POST /api/ops/guardianships/{id}/verify`

- **Auth:** session — **`guardianship.verify`** (name-on-account vs name-on-form is the authority floor).
- **Path param:** `id` (guardianship id). **Request body (optional):** `verificationMethod`.
- **Response `200`:** `{ guardianshipId, status: "verified"|"rejected", matched: boolean, accountClosed: boolean }` (on mismatch the edge is rejected and the accepting account closed).
- **Errors:** `403`; `404` `GuardianshipNotFoundError`; `409` `IllegalGuardianshipTransitionError`.

### `POST /api/ops/guardianships/{id}/revoke`

- **Auth:** session — **`guardianship.revoke`**.
- **Path param:** `id`. **Request body (optional):** `reason` (free text; recorded on the audit entry, never PII; defaults to `standard`).
- **Response `200`:** `{ guardianshipId, status: "revoked", guardianAccountId, studentAccountId }`.
- **Errors:** `403`; `404`; `409`.

### `POST /api/ops/memberships/{id}/activate`

- **Auth:** session — **`member.activate`**. (couplings A + F)
- **Path param:** `id` (membership id). **Request body (optional):** `note`.
- **Response `200`:** `{ membershipId, accountId, tierTransitionId, tier: "explorer" }` (writes the initial Explorer tier transition; the account moves `pending → active` alongside).
- **Errors:** `400` `MembershipActivationConsentError` / `MembershipActivationEvidenceError`; `403`; `404` `MembershipNotFoundError`; `409`.

### `POST /api/ops/students/{id}/consents/safeguard-suspend`

- **Auth:** session — **`consent.revoke_safeguarding`** (the one sanctioned staff write to consent).
- **Path param:** `id` (student account id).
- **Response `200`:** `{ studentAccountId, suspended: [ConsentResult, …] }` — inserts `reason=safeguarding` revokes for `public_profile` and `photo_media`, firing the C1 cascade (depicting media → pending_review) in the same transaction.
- **Errors:** `403`.

### `POST /api/ops/students/{id}/self-private`

- **Auth:** session — the **16+ witnessed** credential privatization; **self-initiated**, gated by self-ownership + an age floor **inside the service** (no registry capability).
- **Path param:** `id` (own account id). **Request body (optional):** `witnessedBy` (string).
- **Response `200`:** `{ accountId, credentialOwner: "self_private", witnessedBy, passwordResetRoute: "chapter_director" }`.
- **Errors:** `400` witness preconditions (`CredentialWitnessRequiredError` / `CredentialWitnessInvalidError` / `CredentialWitnessIsGuardianError`); `403` self/age refusal or null session.

### `POST /api/ops/maturations/{id}/confirm`

- **Auth:** session — **`maturation.confirm`** (Flow D step 3).
- **Path param:** `id` (student account id).
- **Response `200`:** `{ accountId, chapterId, edgesLapsed: number }` — the account converts to `self_managed` and verified guardianship edges lapse.
- **Errors:** `403`; `404` `MaturationAccountNotFoundError` / `MaturationChapterNotFoundError`; `409` `IllegalMaturationTransitionError`.

### `POST /api/ops/accounts/{id}/reissue-setup`

- **Auth:** session — **`account.recover`** (Flow D step 4).
- **Path param:** `id` (account id).
- **Response `200`:** `{ accountId, chapterId, token, expiresAt }` — the raw setup token returned once (mailer seam), consumed later at `POST /api/auth/account-recovery`.
- **Errors:** `403`; `404`; `409` `ReissueActiveMembershipError` (rejected against an account with a live membership).

### `POST /api/ops/deletion-requests/{id}/review`

- **Auth:** session — **`deletion.review`**.
- **Path param:** `id` (deletion request id).
- **Response `200`:** `{ deletionRequestId, subjectAccountId, status: "under_review" }`.
- **Errors:** `403`; `404` `DeletionRequestNotFoundError`; `409` `IllegalDeletionTransitionError`.

### `POST /api/ops/deletion-requests/{id}/fulfill`

- **Auth:** session — **`deletion.fulfill`**.
- **Path param:** `id`. **Request body:** `decision` (required; one of `full`, `redaction`, `refused`, `partial`); `decisionReason` (required for `partial`; optional for `refused`; ignored otherwise).
- **Response `200`:** `{ deletionRequestId, subjectAccountId, status, participationTerminated: boolean, skeletonRemoved: boolean }` (`status` is the resolved terminal state).
- **Errors:** `400` missing/unknown `decision` or missing `decisionReason` for `partial`; `403`; `404`; `409`.

### `POST /api/ops/export-requests/{id}/fulfill`

- **Auth:** session — **`export.fulfill`**.
- **Path param:** `id` (export request id).
- **Response `200`:** `{ exportRequestId, subjectAccountId, status: "fulfilled", bundle: { subjectAccountId, generatedAt, memberships: [...], tierHistory: [...], consents: { <type>: boolean }, timeline: [] } }`.
- **Errors:** `403`; `404` `ExportRequestNotFoundError`; `409`.

### `POST /api/ops/media` — attach media to own project

- **Auth:** session — **`project.submit`** (own; a student attaches to their own project — not `media.review`).
- **Request body:** `projectId` (required); `storageRef` (required); `depictions` (optional array of `{ accountId }` hints — a bad shape is `400`).
- **Response `201`:** `{ mediaId, reviewStatus }`.
- **Errors:** `400` missing field / bad `depictions`; `403`; `404` `ProjectNotFoundError`.

### `POST /api/ops/media/{id}/confirm-depiction`

- **Auth:** session — **`media.review`** (teaching in pod/chapter).
- **Path param:** `id` (media id). **Request body:** `accountId` (required).
- **Response `200`:** `{ mediaId, accountId, source: "mentor"|"staff" }`.
- **Errors:** `400` missing `accountId`; `403`; `404` `MediaNotFoundError`.

### `POST /api/ops/media/{id}/clear`

- **Auth:** session — **`media.review`**.
- **Path param:** `id`.
- **Response `200`:** `{ mediaId, reviewStatus }`.
- **Errors:** `403`; `404`; `409` `MediaNotClearableError` (authorized but not yet clearable).

### `POST /api/ops/media/{id}/remove`

- **Auth:** session — **`media.review`**. Terminal `removed`.
- **Path param:** `id`.
- **Response `200`:** `{ mediaId, reviewStatus }`.
- **Errors:** `403`; `404`.

### `POST /api/ops/terms`

- **Auth:** session — **`term.manage`**.
- **Request body:** `chapterId` (required); `name` (required); `startsOn` (required); `endsOn` (required). (dates as strings)
- **Response `201`:** `{ termId, chapterId, name, startsOn, endsOn }`.
- **Errors:** `400` missing field; `403`.

### `PATCH /api/ops/terms/{id}`

- **Auth:** session — **`term.manage`**.
- **Path param:** `id`. **Request body (all optional):** `name`, `startsOn`, `endsOn`.
- **Response `200`:** `{ termId, chapterId, name, startsOn, endsOn }`.
- **Errors:** `403`; `404` `TermNotFoundError`.

### `POST /api/ops/pods`

- **Auth:** session — **`pod.manage`**.
- **Request body:** `chapterId` (required); `termId` (required); `name` (required); `mentorMembershipId` (optional).
- **Response `201`:** `{ podId, chapterId, termId, name, mentorMembershipId: string|null }`.
- **Errors:** `400` missing field; `403`.

### `POST /api/ops/pods/{id}/assignments`

- **Auth:** session — **`pod.manage`**.
- **Path param:** `id` (pod id). **Request body:** `membershipId` (required); `termId` (required).
- **Response `201`:** `{ podAssignmentId, podId, membershipId, termId }`.
- **Errors:** `400` missing field; `403`; `404` `PodNotFoundError`.

### `DELETE /api/ops/pods/{id}/assignments/{membershipId}`

- **Auth:** session — **`pod.manage`**.
- **Path params:** `id` (pod id), `membershipId`. **Request body:** `termId` (required).
- **Response `200`:** `{ podId, membershipId, termId, removed: boolean }`.
- **Errors:** `400` missing `termId`; `403`; `404`.

### `POST /api/ops/newsletter`

- **Auth:** session — **`newsletter.draft`** (wide: instructor/comms/director).
- **Request body:** `chapterId` (optional — `null` = platform-wide, reachable only via platform grant); `title` (required); `body` (required); `items` (optional array of `{ authorStudentAccountId?, ref?, body (required) }`).
- **Response `201`:** `{ issueId, status }`.
- **Errors:** `400` missing `title`/`body` or malformed `items`; `403`.

### `PATCH /api/ops/newsletter/{id}` — draft-only title/body edit

- **Auth:** session — **`newsletter.draft`** (authorized over the issue's chapter, then a guarded draft-only UPDATE).
- **Path param:** `id`. **Request body (at least one):** `title` (optional); `body` (optional).
- **Response `200`:** `{ issueId, status }`.
- **Errors:** `400` nothing to edit (both absent); `403`; `404` `NewsletterIssueNotFoundError`; `409` non-draft issue (`IllegalNewsletterTransitionError`).

### `POST /api/ops/newsletter/{id}/submit`

- **Auth:** session — **`newsletter.submit_review`**.
- **Path param:** `id`.
- **Response `200`:** `{ issueId, status }` (`draft → in_review`).
- **Errors:** `403`; `404`; `409`.

### `POST /api/ops/newsletter/{id}/schedule`

- **Auth:** session — **`newsletter.schedule`** (`chapter_director`).
- **Path param:** `id`. **Request body:** `scheduledFor` (required; parsed as a Date — invalid → `400`).
- **Response `200`:** `{ issueId, status }` (`in_review → scheduled`).
- **Errors:** `400` missing/invalid `scheduledFor`; `403`; `404`; `409`.

### `POST /api/ops/newsletter/{id}/publish`

- **Auth:** session — **`newsletter.publish`** (`chapter_director`; per-item `external_publication` consent gate, coupling E).
- **Path param:** `id`.
- **Response `200`:** `{ issueId, status }` (`scheduled → published`).
- **Errors:** `403`; `404`; `409` incl. `NewsletterPublishConsentChangedError`.

### `POST /api/ops/newsletter/{id}/unpublish`

- **Auth:** session — **`newsletter.unpublish`** (`chapter_director`).
- **Path param:** `id`.
- **Response `200`:** `{ issueId, status }` (`published → archived`).
- **Errors:** `403`; `404`; `409`.

### `GET /api/ops/audit`

- **Auth:** session — **`audit.view`** (chapter-scoped; a director reads their own chapter, a platform reader any chapter via the override). Writes one `audit.read` entry per query.
- **Query params:** `chapterId` (optional — defaults to the actor's director chapter); `limit` (optional; default 100, max 500).
- **Response `200`:** `{ chapterId, entries: [{ id, at (ISO string), action, subjectType, subjectId, actorAccountId, realActorAccountId, chapterId, detail }] }`, newest first.
- **Errors:** `403` when there is no chapter to scope to (no `chapterId` and no director chapter), or a deny.

---

## 7. Platform admin

### `POST /api/admin/chapters`

- **Auth:** session — **`chapter.manage`** (scope `platform`, `platform_admin` only).
- **Request body:** `name` (required); `slug` (required); `tier` (required; one of `seed`, `active`, `distinguished`); `timezone` (required).
- **Response `201`:** `{ chapterId, name, slug, tier, status, timezone }`.
- **Errors:** `400` missing field / unknown tier; `403`.

### `PATCH /api/admin/chapters/{id}`

- **Auth:** session — **`chapter.manage`** (`platform_admin`).
- **Path param:** `id`. **Request body (all optional):** `name`; `tier` (validated); `status` (one of `prospective`, `active`, `paused`, `closed`).
- **Response `200`:** `{ chapterId, name, slug, tier, status, timezone }`.
- **Errors:** `400` unknown tier/status; `403`; `404` `ChapterNotFoundError`.

### `GET /api/admin/audit`

- **Auth:** session — **`audit.view`** authorized against a **resource with no chapter**, so only the platform override satisfies it (platform-only through the same code path). Writes one `audit.read` entry per query.
- **Query params:** `chapterId` (optional — filters to one chapter); `limit` (optional; default 100, max 500).
- **Response `200`:** `{ entries: [ {AuditEntryView}, … ] }` (same row shape as ops audit; cross-chapter when unfiltered).
- **Errors:** `403` for any non-platform caller / null session.

---

## 8. Public reads

All `public` (no cookie). Only publicly-visible rows are returned (`public_listed` projects, `published` newsletter issues); the read policy is enforced in the WHERE clause. A missing / non-public row is a `404` revealing nothing.

### `GET /api/public/projects`

- **Response `200`:** `{ projects: [{ projectId, title, summary: string|null, chapterId, verifiedAt: string|null (ISO), ownerDisplayName }] }` — `public_listed` only, newest verified first. `ownerDisplayName` is first name + last initial (legal name never rendered).

### `GET /api/public/projects/{id}`

- **Path param:** `id`.
- **Response `200`:** one project summary (same fields as above).
- **Errors:** `404 {"error":"not_found"}` when absent or not `public_listed`.

### `GET /api/public/newsletter`

- **Response `200`:** `{ issues: [{ issueId, title, chapterId: string|null, publishedAt: string|null (ISO) }] }` — `published` only, newest first.

### `GET /api/public/newsletter/{slug}`

- **Path param:** `slug` — this is the `newsletter_issue.id` (there is no slug column; the surface name is `:slug`).
- **Response `200`:** `{ issueId, title, body, chapterId: string|null, publishedAt: string|null, items: [{ body, ref: string|null }] }`.
- **Errors:** `404` when absent or not `published`.

### `POST /api/public/newsletter/subscribe`

- **Auth:** public, inert double-opt-in.
- **Request body:** `email` (required); `source` (optional).
- **Response `202`:** `{ subscriberId, alreadySubscribed: boolean }` — the confirm token stays server-side (emailed, never returned).
- **Errors:** `400` missing `email`.

### `GET /api/public/newsletter/confirm/{token}`

- **Auth:** token (subscriber confirm token), public.
- **Path param:** `token`.
- **Response `200`:** `{ confirmed: true }`.
- **Errors:** `401` unknown/forged token (`InvalidSubscriberTokenError`).

### `GET /api/public/newsletter/unsubscribe/{token}`

- **Auth:** token (subscriber unsubscribe token), public.
- **Path param:** `token`.
- **Response `200`:** `{ unsubscribed: true }`.
- **Errors:** `401` unknown/forged token.

---

## 9. Webhooks

Provider webhooks. **No actor / no `authorize`.** Each verifies the provider signature over the **raw** body (HMAC-SHA256, configurable secret from the host secret store), then dedups on `(provider, event_id)` in the `webhook_event` ledger inside one transaction. A replay is a no-op `200`. The only writes are narrow delivery/payment status. The adapter reads the raw bytes with `req.text()` (a re-serialize would break the HMAC).

### `POST /api/webhooks/resend`

- **Auth:** provider signature. Header: one of `resend-signature`, `svix-signature`, `webhook-signature`. Secret: `RESEND_WEBHOOK_SECRET`.
- **Request:** raw provider JSON — must parse to `{ id (non-empty string), type (string), data? }`.
- **Behavior:** on `email.bounced` / `email.complained`, sets `delivery_status` (`bounced`/`complained`) on matching `newsletter_subscriber` **and** `invite` rows by recipient email. Any other type → recorded for idempotency, ignored.
- **Response `200`:** `{ received: true, deduplicated: boolean, action: string, matched: number }`.
- **Errors:** `400 {"error":"invalid_signature"}` (bad/absent signature — mutates nothing); `400 {"error":"invalid_payload"}` (no event id).

### `POST /api/webhooks/stripe`

- **Auth:** provider signature. Header: `stripe-signature`. Secret: `STRIPE_WEBHOOK_SECRET`.
- **Request:** raw provider JSON — `{ id, type, data }`; the customer ref is read from `data.object.customer`.
- **Behavior:** maps `invoice.paid` / `invoice.payment_succeeded` → `payment_ref.status = active`; `invoice.payment_failed` → `past_due`; keyed on `stripe_customer_ref`. No amounts, no card data. Other types → recorded, ignored.
- **Response `200`:** `{ received: true, deduplicated, action, matched }`.
- **Errors:** `400 invalid_signature` / `400 invalid_payload`.

---

## Deferred / placeholder notes

- **No ops list/GET endpoints.** There is no ops "list applications", "list deletion/export requests", "list invites", or "get one X" read endpoint — only the mutations above. The moderation queue read (`GET /api/lab/moderation/queue`) and the audit readers exist, but they read directly (no dedicated service read method). Guardian and profile reads are the composed-record endpoints above.
- **Placeholder response fields:** `ChildRecord.mentorHours`/`.timeline`, `ProfileView.mentorHours`/`.timeline`, `ChapterDigest.items`, and `ExportBundle.timeline` are honest zero-state placeholders pending later milestones.
- **Mailer seams:** tokens returned "once" (`IssueInviteResult.token`, `ReissueSetupResult.token`, `CreateStudentLinkResult.studentToken`, `RegenerateVerificationResult.token`) and the password-reset / subscriber confirm/unsubscribe tokens are the seams a future mailer consumes; delivery itself is deferred.
- **`GET /api/auth/session`** returns `401 {"error":"unauthorized"}` on no session (it is a public controller), unlike the opaque `403` used by `runAuthed` routes — front-end code should treat both as "not signed in".
