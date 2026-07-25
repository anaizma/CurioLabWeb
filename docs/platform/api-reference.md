# CurioLab Platform API Reference

A practical, front-end-facing reference for the CurioLab platform backend. Generated from the actual code: the controllers in `packages/http/src/controllers/*.ts`, the Next route adapters under `app/api/**/route.ts`, `run.ts` / `respond.ts` / `context.ts`, `packages/core/src/registry.ts`, and the service result types in `packages/app/src`.

Every request field and response shape below is taken from the controller (request fields from its `reqStr` / `optStr` / `reqObj` reads; response shapes from the service result type it returns). Where a shape is a placeholder or a service method is missing, it is called out inline.

---

## How auth works

- **Session cookie.** Authenticated endpoints read an opaque session token from the cookie **`cl_session`** (constant `SESSION_COOKIE`). `POST /api/auth/login` sets it (httpOnly, sameSite=lax, secure, path=`/`, 30-day expiry); `POST /api/auth/logout` and `DELETE /api/auth/impersonate` clear it. The raw token is never stored server-side — only its hash.
- **`runAuthed` vs `runPublic`.** Authed controllers resolve the cookie to an `AuthContext` (`context.ts`). A missing / unknown / expired / revoked session resolves to a **null context**, which becomes an **opaque `403 {"error":"forbidden"}` with no audit** (there is no actor to attribute). Public / token-gated controllers take no `AuthContext`.
- **Opaque 403.** A denied capability (`Forbidden`) and a null session both return the identical `403 {"error":"forbidden"}` body — "not allowed", "out of scope", and "does not exist" are deliberately indistinguishable from outside. Do not branch on 403 sub-reasons; there are none.
- **Capabilities.** Each authed endpoint names the registry capability its service authorizes (`registry.ts`). Chapter-scoped capabilities require an in-force membership of the listed role in the resource's chapter; `platform`-scoped ones are reachable only via the platform override (`platform_admin`, or `platform_staff` for read-only capabilities).
- **Unauthenticated / token-gated routes** (no `cl_session` needed): the Apply funnel (`/api/apply`, `/api/public/stage2/*`), `POST /api/auth/login`, the §10 two-factor continuation `POST /api/auth/totp{,/enroll,/confirm}` (gated by the short-lived pending-2FA token from login, not a session), `POST /api/auth/password/reset-request`, `POST /api/auth/password/reset`, `POST /api/auth/account-recovery`, all `/api/invites/[token]*`, `GET /api/verify/[token]`, all `/api/public/**` reads and newsletter subscribe/confirm/unsubscribe, and both `/api/webhooks/*`. These carry their own gate (an opaque token or a webhook signature), not a session.

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
- **Response `201`** (recommended, per the snippet): `{ leadId: string, suppressed: boolean, parentToken: string|null }`. `suppressed:true` means an in-window duplicate email matched and no new row was written (still returns the existing `leadId`, with `parentToken:null`). **`parentToken`** is the raw Stage-2 token returned **only** for a parent-filler (`fillerRole:"parent"`) so they can continue straight into Stage 2; it is `null` for a student-filler (`fillerRole:"student"` — the parent receives the token by email later) and `null` for a suppressed duplicate. The frontend uses `parentToken` to build the "continue to the application" link for a parent-filler; for a student-filler it shows "we've emailed your parent".
- **Behavior:** creates exactly one `application_lead` (status `new`), issues a hashed Stage-2 token (the hash is always stored on the lead; the raw token is returned **only** to a parent-filler — for a student-filler it is withheld for the future parent mailer), stamps `expires_at = created_at + 30d`. Creates no account and no application. Dedupe window and expiry are config tunables. Rate-limiting / bot checks are the HTTP layer's job (not in the service).

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
  // parentToken is the raw Stage-2 token for a parent-filler (the frontend builds
  // the "continue to the application" link from it); it is null for a student-filler
  // (show "we've emailed your parent") and null for a suppressed duplicate.
  return Response.json(
    { leadId: result.leadId, suppressed: result.suppressed, parentToken: result.parentToken },
    { status: 201 },
  )
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
- **Side effect:** mints a fresh **review token** (stores its hash on the draft; supersedes any prior one) and emails the parent a "ready to review" note with a working **"Review and submit" button** (`${APP_URL}/apply/review/{reviewToken}`) that drives the 2C ops. Best-effort — a mail failure is logged, not fatal (the save already committed).
- **Errors:** `400` missing fields, or a disallowed / identifying student field (`StudentSectionFieldNotAllowedError`, `StudentSectionIdentifyingFieldError`); `401` invalid token; `409` wrong phase.

### `POST /api/public/stage2/draft` — read-only 2A prefill (resume)

- **Auth:** token (**parent token**). Phase: any (`2a`/`2b`/`2c`). Read-only — mutates nothing, no phase change.
- **Purpose:** prefill-on-resume. A returning parent reads their saved 2A answers so the resumed form is pre-filled rather than blank; without it, a blank still-saveable 2A form would let `saveParentSection`'s additive merge silently overwrite previously-saved answers.
- **Request body:** `token` (string, required) — parent token.
- **Response `200`:** `{ phase: string, parentAnswers: object }` — the saved 2A answers (empty object `{}` if none yet). Never includes the student's answers (those stay with `/review` at 2C).
- **Errors:** `400` missing `token`; `401` invalid / student / forged token (`InvalidStage2TokenError`).

### `POST /api/public/stage2/student-draft` — read-only 2B prefill (resume)

- **Auth:** token (**student token**). Phase: any. Read-only — mutates nothing, no phase change.
- **Purpose:** prefill-on-resume. A student who closes and reopens their section reads their saved 2B answers so they resume without losing work.
- **Request body:** `token` (string, required) — student token.
- **Response `200`:** `{ phase: string, studentAnswers: object }` — the saved 2B answers (empty object `{}` if none yet). Returns only the student's own section.
- **Errors:** `400` missing `token`; `401` invalid / parent / forged token (`InvalidStage2TokenError`).

> **The 2C ops accept two tokens.** `review`, `submit`, and `send-back` accept a token matching the draft's **parent token** OR the **review token** — a fresh token minted when the student finishes 2B and delivered to the parent as the "Review and submit" button in the ready-to-review email (see `/student` below). Both are the parent's own credentials, so either reaches 2C; a **student token** matches neither and is rejected. The review token has no separate expiry (it inherits the lead's 30-day request-time window). `send-back` clears the review token, so the stale button stops working; the next student finish mints a new one. No other op is broadened.

### `POST /api/public/stage2/review` — read-only 2C view

- **Auth:** token (**parent token OR review token**). Phase: 2C.
- **Request body:** `token` (string, required) — parent token or the emailed review token.
- **Response `200`:** `{ phase: string, status: string, parentAnswers: object|null, studentAnswers: object|null }` (student answers are read-only to the parent).
- **Errors:** `400` missing `token`; `401` invalid token.

### `POST /api/public/stage2/submit` — submit 2C, mint the application

- **Auth:** token (**parent token OR review token** — both are the parent's; a student token is rejected). Phase: 2C.
- **Request body:** `token` (string, required) — parent token or the emailed review token.
- **Response `201`:** `{ applicationId: string, leadId: string }`.
- **Errors:** `400` missing `token` or incomplete parent facts (`Stage2ParentFactsIncompleteError`) / missing lead chapter (`Stage2LeadChapterRequiredError`); `401` invalid token; `409` wrong phase.

### `POST /api/public/stage2/send-back` — bounce 2C → 2B

- **Auth:** token (**parent token OR review token**). Phase: 2C → 2B. Clears the review token so the stale review button stops working.
- **Request body:** `token` (string, required) — parent token or the emailed review token.
- **Response `200`:** `{ sentBack: true }`.
- **Errors:** `400` missing `token`; `401` invalid token; `409` wrong phase.

---

## 2. Auth & onboarding

### `POST /api/auth/login` — two-step for privileged accounts (§10)

- **Auth:** public. Sets `cl_session` **only** when a full session is minted.
- **Request body:** `identifier` (string, required — email **or** username, case-insensitive); `password` (string, required).
- **Response `200`** — a discriminated union on the password result:
  - **Non-privileged** account (a `student`/`alumni` role, or no membership at all — e.g. a guardian): `{ accountId: string }` (+ `Set-Cookie: cl_session`). Password-only, unchanged.
  - **Privileged** account **with** active TOTP: `{ totpRequired: true, pendingToken: string }` — **no** cookie. The password was correct but no session exists yet; POST the second factor + `pendingToken` to `/api/auth/totp`.
  - **Privileged** account **without** TOTP yet (forced first-login enrollment): `{ totpEnrollmentRequired: true, pendingToken: string }` — **no** cookie. Call `/api/auth/totp/enroll` then `/api/auth/totp/confirm` with the `pendingToken`.
- **Privileged roles** (mandate a second factor): every membership role **except** `student` and `alumni` — i.e. `platform_admin`, `platform_staff`, `chapter_director`, `lead_instructor`, `senior_instructor`, `junior_mentor`, `comms_associate` (`PRIVILEGED_ROLES`/`requiresTwoFactor` in `@curiolab/core`).
- **`pendingToken`** is a **short-lived (5 min) pending-2FA state, NOT a session** — it confers no authority; only the totp submit/confirm step mints the `cl_session` cookie. It is returned in the JSON body (the frontend holds it transiently).
- **Errors:** `400` missing field; `401 {"error":"unauthorized"}` for **any** password failure (unknown account, no password set, closed/suspended, or bad password — uniform, no enumeration).

### `POST /api/auth/totp` — submit the second factor (finish a `totpRequired` login)

- **Auth:** public, gated by the `pendingToken`. Sets `cl_session` on success.
- **Request body:** `pendingToken` (string, required); `code` (string, required — a 6-digit TOTP code **or** an `xxxxx-xxxxx` backup code).
- **Response `200`:** `{ accountId: string }` (+ `Set-Cookie: cl_session`). Verifies the second factor (RFC 6238, ±1 step window, per-account last-step replay guard; a backup code is consumed on use), consumes the pending token, mints the session, and writes a `login.two_factor` access-ledger row.
- **Errors:** `400` missing field; `401 {"error":"invalid_token"}` for a bad/expired/consumed `pendingToken` **or** a wrong/replayed TOTP code / unknown/used backup code (uniform, no signal); `409` if the account has no active TOTP; `429 {"error":"rate_limited"}` when second-factor attempts exceed the limit (5 failures / 15-min rolling window).

### `POST /api/auth/totp/enroll` — begin forced enrollment (a `totpEnrollmentRequired` login)

- **Auth:** public, gated by the `pendingToken`. Mints **no** session.
- **Request body:** `pendingToken` (string, required).
- **Response `200`:** `{ secret: string, otpauthUri: string }` — the base32 shared secret and the `otpauth://totp/...` provisioning URI (**no QR image** — the frontend renders it). The account is not yet active on TOTP.
- **Errors:** `400` missing field; `401` bad/expired `pendingToken`; `409` if TOTP is already active (`TotpAlreadyActivatedError`).

### `POST /api/auth/totp/confirm` — confirm enrollment (activate + mint the session)

- **Auth:** public, gated by the `pendingToken`. Sets `cl_session` on success.
- **Request body:** `pendingToken` (string, required); `code` (string, required — a TOTP code for the secret from `/enroll`).
- **Response `200`:** `{ accountId: string, backupCodes: string[] }` — the one-time recovery codes returned **once** (10 codes, each `xxxxx-xxxxx`; stored only as argon2id hashes). Activates TOTP, seeds the replay guard, consumes the pending token, mints the session, and writes a `totp.enrolled` access-ledger row.
- **Errors:** `400` missing field; `401` bad `pendingToken` or a wrong confirm code; `409` already active / no pending secret; `429` attempt rate limit.

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
- **Response `201`:** `{ accountId: string, guardianshipId: string|null, setupToken?: string, setupTokenRoute?: "guardian", guardianAccountId?: string|null }`.
- **Errors:** as `accept` above.

**§3 guardian-before-student preconditions (the COPPA ordering invariant).** When the student invite's enrollment already binds a **guardian-provisioned** student account, accept-student **credentials that existing account** (rather than creating one) and is **refused unless**: (a) a **VERIFIED** guardianship edge exists for that student (a merely-`pending` edge is refused), **AND** (b) the guardian's **`platform_participation`** consent (the "may have a platform account" record that exists today) is currently active. Any failure is the **same opaque `401 invalid_token`** as a forged link and leaves the invite `issued` (usable on retry once the guardian verifies) — it reveals neither which gate failed nor whether the student exists. On success the account stays `pending` (no membership until `member.activate`), so **a student invite alone can never stand up an active student**. The one-time **setup credential is routed to the guardian, never emailed to the child**: the backend mints a `minor_setup` credential token bound to the student account, returns it once as `setupToken` with `setupTokenRoute:"guardian"` + `guardianAccountId` (a delivery seam the frontend fulfils). Redemption and the referenced consent artifact/method are written to the §8 access ledger with the source IP.

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

## 3a. Consent as an append-only GRANT ledger (§5 — REVIEW-GATED, additive)

**Status: built-but-gated.** Consent is *also* stored as a set of independent, append-only **grant** records (table `consent_grant`, a PEER of the existing `consent` block ledger — the block ledger is untouched and still gates membership activation / accept-student). Six grant types, each on its own renewal clock: `program_participation`, `platform_account`, `public_publication`, `photo_video_likeness`, `emergency_medical_pickup`, `verification_link_sharing`. A revocation or renewal is a NEW row, never a mutation (append-only trigger + role REVOKE). Current status per (subject, type) is the `consent_grant_current` view (active iff the latest row is non-revoked AND non-expired).

**The REVIEW GATE — `CONSENT_GRANT_LEDGER_ENFORCED` (env, default `false`).** When **false** (production posture until legal review), the new **public-publication ENFORCEMENT** is dormant: narrative publish, project `public_listed`, and newsletter inclusion keep their existing `consent` gates unchanged, and the notify-and-object window does not run. When **true**, those publish paths **additionally** require an active `public_publication` grant for the student (internal/platform access requires `platform_account`); no other grant substitutes. Grant **capture** and per-grant **revocation** endpoints below are always live (they only write the grant ledger); only the enforcement seams are gated.

**Strong verification (Rule 2).** Capturing `public_publication` for a subject **under 13** requires an FTC-approved strong `method` (`signed_form` | `monetary_transaction` | `video_call` | `id_verification`) AND a non-null `evidenceArtifactRef` — a `click`, or a missing artifact, is refused (service pre-check + a DB trigger backstop). Age is computed from the subject's DOB. For **13+**, a `click` is accepted. `evidenceArtifactRef` is an opaque storage reference the frontend/ops supplies (no file storage in-band).

### `GET /api/guardian/children` — the guardian's verified children

- **Auth:** session — **`guardian.list_children`**.
- **Response `200`:** `{ items: [{ childAccountId, displayName }] }` (display names only — minor PII floor).

### `GET /api/guardian/children/{id}/grants` — per-child grant statuses

- **Auth:** session — **`guardian.view_grants`**.
- **Response `200`:** `{ items: [{ grantType, status: "active"|"expired"|"revoked"|"none", expiresAt: string|null, method: string|null, evidenceArtifactRef: string|null }] }` — all six types, current status each.

### `GET /api/guardian/children/{id}/public-items` — the child's public-surface items

- **Auth:** session — **`guardian.view_public_items`**.
- **Response `200`:** `{ items: [{ type: "project"|"narrative", ref, title: string|null }] }` — `public_listed` projects + `published` narratives only, never drafts or private messages.

### `POST /api/guardian/children/{id}/grants` — capture (or renew) a grant

- **Auth:** session — **`consent.grant`** (guardian for a minor child; an 18+ student self-grants via the own scope).
- **Path param:** `id`. **Request body:** `grantType` (required; one of the six), `method` (required; one of `click` | `signed_form` | `monetary_transaction` | `video_call` | `id_verification`), `evidenceArtifactRef` (string, optional), `scope` (string, optional).
- **Response `201`:** `{ grantId, subjectStudentAccountId, grantType, method, expiresAt: string|null, renewal: boolean }`. `expiresAt` is stamped per the renewal clock (per-term / annual / standing → null).
- **Errors:** `400` missing/unknown `grantType`/`method`, or `GrantStrongMethodRequiredError` (under-13 public_publication weak method / no artifact); `403` scope deny / null session; `404` unknown subject.

### `POST /api/guardian/children/{id}/grants/{type}/revoke` — per-grant revoke (Rule 5)

- **Auth:** session — **`consent.revoke`**. Writes a revocation row for THAT grant type only (others untouched). Revoking `public_publication` **cascades**: the child's currently-public items are unpublished/withheld (projects `public_listed → verified`, narratives `published → pending_review`, published newsletter items redacted) in the same transaction.
- **Path params:** `id`, `type` (one of the six).
- **Response `200`:** `{ grantId, subjectStudentAccountId, grantType, cascaded: boolean }`.
- **Errors:** `409` `GrantRevocationEndsEnrollmentError` (revoking `program_participation`/`emergency_medical_pickup` is refused and routed to the enrollment path) or `GrantNotActiveError` (nothing active to revoke); `403` scope deny / null session.

### `POST /api/guardian/children/{id}/publication-holds/{holdId}/object` — withhold one item (Rule 3)

- **Auth:** session — **`publication.object`** (guardian write; barred once the child is 18). Part of the notify-and-object window (gated by `CONSENT_GRANT_LEDGER_ENFORCED`). Withholds THIS nominated item without touching the grant. Idempotent.
- **Path params:** `id`, `holdId`.
- **Response `200`:** `{ holdId, objected: boolean }`.
- **Errors:** `404` `PublicationHoldNotFoundError`; `403` scope deny / null session.

**The notify-and-object window (job contract, backend).** When an item is nominated for a public surface, `nominatePublicationHold` records a `publication_hold` (item ref, subject, `nominated_at`, guardian notified, `releases_at = nominated_at + N days`, default `N = 5`) and a `publication.notified` ledger row. The job body `runPublicationHolds({ sql, publish? }, now)` — a deterministic, injected-`now` sweep, no live scheduler — **publishes** an un-objected hold once its window elapses (`released_at` stamped, `publication.released` logged, publish seam fired post-commit) and **withholds** an objected one. Idempotent. **18th-birthday transfer (Rule 4):** hooked into `maturation.confirm` — the guardian's active grants **lapse** (a new revoking row each; `grant.transferred` logged) and the now-adult re-confirms the persisting ones (publication, likeness, verification-link) via the self-grant path.

**§8 ledger.** Every capture / renewal / revocation / notify / object / release / birthday-transfer is written to the append-only `access_ledger` with the method + artifact reference (events `grant.captured`, `grant.renewed`, `grant.revoked`, `grant.transferred`, `publication.notified`, `publication.objected`, `publication.released`).

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

- **Auth:** session — **per-kind capability** (see the authority matrix below). The route manifest binds this endpoint to `['member.invite', 'member.invite_admin']`; the service picks the gating capability from `kind`.
- **Request body:** `kind` (required; one of `guardian`, `mentor`, `staff`, `director`, `admin` — `student` is a valid kind value but is **not issuable here**); `chapterId` (required); `targetEmail` (optional; **required in practice for the adult kinds** so the redemption email binding has a value); `enrollmentRecordId` (optional; carries the chapter for guardian invites); `intendedAccountId` (optional).
- **Response `201`:** `{ inviteId, token, expiresAt }` — the raw token returned once (only its SHA-256 hash is stored). `expiresAt` is the **per-kind TTL** (below).
- **Errors:** `400` missing/unknown `kind`, or `InviteKindNotIssuableError` for `kind: "student"`; `403` opaque (per-kind authority not met — e.g. a lone director trying `admin` or a direct `director`); `429` `InviteRateLimitError` (per-issuer cap tripped).

**Per-kind issuing authority (§1).** The base `member.invite` is `chapter_director` OR `comms_associate` (platform_admin via override). The two privileged kinds refine it:

| kind | who may issue | gating capability |
|---|---|---|
| `guardian` / `mentor` / `staff` | chapter_director or comms_associate (platform_admin via override) | `member.invite` |
| `admin` | **platform_admin only** | `member.invite_admin` |
| `director` (direct) | **platform_admin only** — a lone chapter_director is refused and must use the two-person flow | `member.invite_admin` |
| `director` (two-person) | **two DISTINCT chapter_directors** (platform_admin reaches it via override) | `member.invite_director` (see below) |
| `student` | **not issuable here** — a student account originates from a consented guardian via `accept-student` | — |

**Per-kind expiries (§4).** Adult kinds (`mentor`, `staff`, `director`, `admin`) expire in **72h**; `guardian` (and the seeded `student`) invites in **~7 days**. Evaluated at decision time against `now`.

**Token hardening (§4).** The token is opaque CSPRNG output and carries **no email or name** — the email lives only on the invite row (`target_email`), and the chapter is bound on the row (`bound_chapter_id`). At redemption the accept endpoints verify the presented `{ email, kind, chapter }` match the invite's bound values and refuse (opaque `invalid_token`) on mismatch. Issuance is **rate-limited per issuer** (default 30 invites / 60 min).

### `POST /api/ops/invites/director-requests` — initiate a two-person director invite (§1)

- **Auth:** session — **`member.invite_director`** (`chapter_director`; platform_admin via override).
- **Request body:** `chapterId` (required); `targetEmail` (required).
- **Response `201`:** `{ requestId, expiresAt }` — a **pending request with NO token**. A second, distinct director must approve before the director invite exists. `expiresAt` is the adult 72h window.
- **Errors:** `400` missing field; `403`.

### `POST /api/ops/invites/director-requests/{id}/approve` — approve + mint (§1)

- **Auth:** session — **`member.invite_director`**. The approver **MUST be a director DISTINCT from the initiator** (the two-person rule; the `director_invite_request` DB CHECK is the floor).
- **Path param:** `id` (director-invite request id).
- **Response `201`:** `{ requestId, inviteId, token, expiresAt }` — the director invite is minted (kind `director`, bound to `{ target_email, chapter }`, 72h expiry) and the request is stamped `approved` with the approver + timestamp + minted `invite_id`, all in one transaction. The raw token is returned once.
- **Errors:** `403`; `404` `DirectorInviteRequestNotFoundError`; `409` `DirectorInviteSameApproverError` (same director) or `DirectorInviteRequestNotPendingError` (already approved / expired); `429` `InviteRateLimitError`.

### `POST /api/ops/invites/{id}/resend`

- **Auth:** session — **per-kind capability** (manifest `['member.invite', 'member.invite_admin']`): a privileged invite (`admin`/`director`) may only be resent by a platform_admin; `guardian`/`mentor`/`staff` by the base `member.invite`. Supersedes + reissues with the per-kind TTL and the same chapter binding.
- **Path param:** `id` (invite id).
- **Response `201`:** `{ inviteId, token, expiresAt }`.
- **Errors:** `403`; `404` `InviteNotFoundError`; `429` `InviteRateLimitError`.

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

### `POST /api/ops/accounts/{id}/assist-recovery` — logged mentor/director-assisted MINOR recovery (§9)

- **Auth:** session — **`account.assist_recovery`** (chapter-scoped; **teaching roles** `junior_mentor`/`senior_instructor`/`lead_instructor`/`chapter_director`; `platform_admin` via override, `platform_staff` denied). Distinct from `account.recover` (the adult former-student reissue).
- **Path param:** `id` (the minor's account id).
- **Behavior:** a mentor/instructor present **with the minor in person** mints a fresh **guardian-routed** `minor_setup` credential token (a regenerate supersedes the prior live one), and records the event on **both** the §8 access ledger (`recovery.mentor_assisted` — who assisted, which minor, when, **source IP**) and the audit trail. A **minor's** self-serve password reset (`/auth/password/reset-request`) is already guardian-routed (route `guardian`, the token bound to the child account but never delivered to the child); this is the in-person alternative for a locked-out minor.
- **Response `200`:** `{ accountId, chapterId, token, expiresAt, route: "guardian" }` — the raw setup token returned once (a guardian-delivery seam).
- **Errors:** `400` `MaturationAgeError` (the subject is **not** a minor — an adult recovers via the ordinary reset / `account.recover`); `403` deny / null session; `404` unknown account / no enrolling chapter.

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

### `GET /api/ops/access-ledger` — the append-only invitation/access ledger (§8)

- **Auth:** session — **`ledger.read`** (chapter-scoped; a director reads their **own** chapter, cross-chapter is `403`; both platform overrides reach it — `writes:false`). Mirrors the audit read's chapter resolution (`?chapterId` or the actor's director chapter) but is a **peer** surface with its own capability, so the ledger and the audit trail scope independently. This read is **not** self-logging (the ledger records origination events, not reads).
- **Query params:** `chapterId` (optional — defaults to the actor's director chapter); `limit` (optional; default 100, max 500).
- **Response `200`:** `{ chapterId, items: [{ id, at (ISO), event, inviteId, inviteKind, chapterId, targetEmail, consentMethod, actorAccountId, actorDisplayName, subjectAccountId, subjectDisplayName, guardianAccountId, guardianDisplayName, detail }] }`, newest first. **Minor PII is hidden**: display names are the first-name + last-initial `account.display_name` (never a raw last name), and the stored **client IP is NOT surfaced** (a forensic field kept on the row, not returned to the ops read).
- **`event`** ∈ `invite.issued` (issuer + target + kind + chapter), `invite.redeemed` (accepting account + IP), `accept_student.consent` (the guardian consent artifact/method referenced at accept-student + guardian-routing), `membership.activated`, `recovery.mentor_assisted`, `recovery.guardian_routed`.
- **Errors:** `403` when there is no chapter to scope to, a cross-chapter `?chapterId`, or a deny / null session.

> **The ledger table (§8; `access_ledger`, migration 0022).** An **append-only** record (never mutated — a correction is a new row; enforced by the shared `reject_append_only_mutation()` trigger backstop **and** a role-level `REVOKE UPDATE, DELETE`) capturing the account-**origination + access** chain. It is a **PEER of `audit_entry`**, not an extension: the audit log is the *authorization-decision* record (`permission.denied`, capability reads, ops transitions), whereas the ledger is the *origination/access-provenance* record and carries columns the audit row does not — a `client_ip` (`inet`), the `target_email`, the `invite_kind`, and the `consent_ref`/`consent_method`. Keeping them peers keeps the audit log's meaning clean and gives origination provenance its own queryable, IP-bearing, minor-PII-hiding shape and its own read capability. The analytics read role is **denied `SELECT`** (default-deny, like `enrollment_record`/`guardianship`).

---

## 6a. Ops director-portal reads (P1)

The chapter-scoped list/detail GETs the director portal reads (`docs/platform/director-portal-read-endpoints.md`). All `session`, chapter-scoped to the Chapter Director; a `platform_admin`/`platform_staff` sees all chapters via the read override, or one via `?chapterId`. **A null session and a non-director are both an opaque `403`** (these use `runAuthed`, so no session is `403`, not `401` — treat both as "not signed in"). A cross-chapter `?chapterId` is a `403`. Lists return `200 { items: [...] }` (bare envelope). Each surface gates on a new chapter-scoped read capability (`writes:false`, roles `[chapter_director]`, admin via `platformGrant`); the media queue reuses `media.review`. Display names are the first-name + last-initial `account.display_name`, except (a) the guardianship name-match fields and (b) the **applications** list/detail, which by authorized design return the FULL applicant name/grade/school/parent/contact to the chapter director for their own chapter (see the applications note below) — every other surface keeps the minor last-name/school masked. **GET routes carry no route-manifest entry** (only mutating methods are manifested).

> **Full applicant PII, by design (applications surface only).** Unlike every other director read (which masks a minor to a first-name + last-initial display name), the applications list/detail return the **FULL** applicant name, grade, school, parent name, and contact email to the chapter director for **their own chapter's** applications — an authorized application-processing use. `application.read` already restricts this to that chapter's director (+ admin), and no cross-chapter leak is possible. This exposure is **scoped to `/api/ops/applications*`**; no other surface's PII behavior changes.

### `GET /api/ops/applications` — list (`application.read`)
- **Query:** `?status=` (repeatable or CSV; DB enum values `submitted|screening|interview_scheduled|accepted|enrolled|declined|withdrawn` — `interview` is accepted as an alias of `interview_scheduled`); `?chapterId=`; `?view=full`; `?termId=<id>|all`.
- **Term filter + default:** each application's term is derived by **date-containment** — the term in the application's chapter whose `[starts_on, ends_on]` window contains `created_at` (an application captures no term column). `?termId=<id>` filters to applications whose `created_at` falls in that term's window; `?termId=all` returns every term; **with no `termId` the list defaults to the MOST RECENT term** (the latest `starts_on` that has started, else simply the latest `starts_on`, within the caller's chapter scope) and filters to it. The resolved active term is echoed in the envelope (`activeTermId`/`activeTermName`, `null` for `?termId=all` or when no terms exist).
- **`200` (default view):** `{ items: [{ applicationId, status, studentName: string|null (FULL applicant name), gradeLevel: string|null (draft `parentAnswers.gradeEntering`), submittedAt (ISO), chapterId, termId: string|null, termName: string|null }], activeTermId: string|null, activeTermName: string|null }`.
- **`?view=full`** adds three fields to each item (data-minimized — present only with `view=full`): `guardianName: string|null` (FULL parent name, `application.guardian_name`), `school: string|null` (draft `parentAnswers.schoolName`), `contactEmail: string|null` (`guardian_email ?? applicant_contact_email`).

### `GET /api/ops/applications/{id}` — detail (`application.read`)
- **`200`:** `{ applicationId, status, submittedAt (ISO), chapterId, termId: string|null, termName: string|null, student: { fullName: string|null, gradeLevel: string|null, school: string|null, contactEmail: string|null }, guardian: { fullName: string|null, email: string|null }, answers: { stage2a: {…}, stage2b: {…}, stage2c: null }, history: [{ from: string|null, to, at (ISO), note: string|null }] }`. `student` carries the FULL applicant record (name from `applicant_name`, grade/school from the draft's `parentAnswers.gradeEntering`/`schoolName`, contact = `guardian_email ?? applicant_contact_email`); `termId`/`termName` are derived by date-containment. `stage2a`/`stage2b` are the funnel draft's **complete, unmodified** parent/student answer blobs (every key — the questionnaire the parent reviewed); there is no separate `stage2c` blob (always `null`). `history` is the `application_event` trail, oldest first. `404` if unknown; `403` cross-chapter.

### `GET /api/ops/invites` — list (`invite.read`)
- **`200`:** `{ items: [{ inviteId, kind, targetEmail: string|null, status: "pending"|"accepted"|"expired"|"superseded", issuedAt (ISO), expiresAt (ISO), acceptedAccountId: string|null }] }`. **The raw token / token_hash is never returned.** `status` maps the DB `invite_status` (`issued`→`pending`, or `expired` when past `expires_at`; `revoked`→`superseded`). `acceptedAccountId` is the invite's `intended_account_id` (there is no `accepted_account_id` column). Chapter = the bound enrollment's chapter, else the issuer's chapter membership.

### `GET /api/ops/memberships` — roster (`membership.read`)
- **Query:** `?status=`, `?role=` (repeatable/CSV), `?chapterId=`.
- **`200`:** `{ items: [{ membershipId, accountId, displayName, role, status, tier: string|null, podId: string|null, joinedAt (ISO) }] }`. `status`/`role` are the DB enum values (`status` ∈ `pending|active|inactive|offboarded|suspended`); `joinedAt` is `created_at`.

### `GET /api/ops/guardianships` — list (`guardianship.read`)
- **`200`:** `{ items: [{ guardianshipId, status, guardianDisplayName, guardianNameOnAccount, studentDisplayName, nameOnForm, createdAt (ISO) }] }`. The one surface that returns a legal name: `guardianNameOnAccount` (the guardian account's `legal_name`) vs `nameOnForm` (the enrollment's `guardian_name_on_form`) is the verify match. Chapter = the student's most recent enrollment chapter.

### `GET /api/ops/media/review-queue` — list (`media.review`)
- **`200`:** `{ items: [{ mediaId, projectId: string|null, projectTitle: string|null, reviewStatus, storageRef, depictions: [{ accountId, displayName, confirmed: boolean }], submittedAt (ISO) }] }`. Only `pending_review` media. No `flaggedReason` field (no such column). Gated on the existing `media.review` (teaching roles reach it).

### `GET /api/ops/deletion-requests` — list (`deletion.read`) · `GET /api/ops/export-requests` — list (`export.read`)
- **`200`:** `{ items: [{ deletionRequestId | exportRequestId, subjectAccountId, subjectDisplayName, status, requestedAt (ISO) }] }`. Chapter = the subject's most recent enrollment chapter.

### `GET /api/ops/enrollments` — list (`enrollment.read`)
- **`200`:** `{ items: [{ enrollmentRecordId, applicationId, studentDisplayName: string|null, termId, termName: string|null, guardianNameOnForm, signatureDate: string|null, hasAccount: boolean }] }`. `studentDisplayName` is the linked account's display name, else derived from the application applicant name; `signatureDate` is `form_signed_at`; `hasAccount` = `student_account_id` present.

### `GET /api/ops/pods` — list (`pod.read`) · `GET /api/ops/terms` — list (`pod.read`)
- **Pods `200`:** `{ items: [{ podId, name, termId, mentorMembershipId: string|null, mentorDisplayName: string|null, memberCount: number }] }` (`memberCount` = `pod_assignment` rows).
- **Terms `200`:** `{ items: [{ termId, name, startsOn, endsOn }] }`. (Terms are gated with pods on `pod.read`.)

### `GET /api/ops/dashboard` — count summary (`application.read`)
- **`200`:** `{ newApplications, pendingInvites, guardianshipsToVerify, mediaToReview, openRequests, activeMembers }` — chapter-scoped counts (`newApplications` = `submitted`; `pendingInvites` = live `issued`; `guardianshipsToVerify` = `pending`; `mediaToReview` = `pending_review`; `openRequests` = open deletion + export; `activeMembers` = `active` memberships).

---

## 6b. Mentor eligibility as state (§6 — REVIEW-GATED, additive)

Mentor eligibility is recorded as **STATE**: an append-only `mentor_eligibility` clearance ledger (migration `0025`) per `(membership, component)`, over the four components `background_check`, `mandatory_reporter_training`, `cwru_affiliation_verified`, `signed_code_of_conduct`. A mentor is **eligible** iff all four are currently satisfied (present AND not past their expiry as of `now`); a renewal is a new row, a lapse is expiry. The current status is the `mentor_eligibility_current` view; `evaluateMentorEligibility` (core, pure) is the predicate.

**The REVIEW GATE — `MENTOR_ELIGIBILITY_ENFORCED` (env, default `false`).** When **false** (production posture until legal review), eligibility is **recorded but never blocks**: a mentor's student-facing access is exactly as today, the `can` eligibility predicate is dormant, and the auto-revoke sweep records nothing on eligibility grounds. When **true**, a teaching membership marked ineligible no longer confers the **student-facing capability set** — `feed.view/post/comment/react`, `feed.moderate`, `feed.hide_safety`, `moderation.resolve`, `project.verify`, `media.review`, `narrative.review`, `narrative.remove`, `student.view_record`, `account.assist_recovery` — `can` denies opaque `out_of_scope` (no leak of why). A mentor's own non-student-facing actions (managing their own account, `feed.report` safety valve) are never gated; `student`/`alumni`/`comms` roles are never eligibility-gated. **The gate lives in the pure `can` layer** (a flag-guarded predicate composing with the existing `inForce` checks); the app-layer context builder hydrates `Membership.mentorEligible` + `AuthContext.enforceMentorEligibility` only when the flag is on (flag off → no extra query, no field set). The record/read endpoints below are always live (they only write/read the eligibility ledger); only the enforcement is gated.

### `POST /api/ops/mentors/{membershipId}/eligibility` — record a component clearance
- **Auth:** session — **`mentor.manage_eligibility`** (chapter-scoped write, `chapter_director`; `platform_admin` via override; a read-only `platform_staff` cannot).
- **Path param:** `membershipId` (the mentor's membership). **Request body:** `component` (required — one of the four); `clearedAt` (optional ISO; defaults to now); `expiresAt` (optional ISO; null = standing); `version` (optional — code-of-conduct version); `evidenceRef` (optional — opaque artifact reference).
- **Response `201`:** `{ eligibilityId, membershipId, component, clearedAt, expiresAt }`. Writes an `audit_entry` (`action = mentor.eligibility_recorded`) + an `access_ledger` row (`event = mentor.eligibility_recorded`, subject = the mentor's account).
- **Errors:** `400` unknown component / bad date; `403`; `404` `MembershipNotFoundError`.

### `GET /api/ops/mentors/{membershipId}/eligibility` — the mentor-eligibility panel read
- **Auth:** session — **`membership.read`** (reuses the P1 chapter-scoped roster read; both platform overrides reach it). GET-exempt from the route-manifest guard.
- **Path param:** `membershipId`.
- **Response `200`:** `{ membershipId, eligible: boolean, unmet: component[], components: [{ component, active, clearedAt, expiresAt, version, evidenceRef }] }`.
- **Errors:** `403`; `404` `MembershipNotFoundError`.

**Auto-revoke sweep — `runEligibilitySweep({ sql }, now, config)` (job body, flag-guarded).** A PEER of `runTimeBoxSweep` (not folded in — different trigger, different role set, independent gate). With `mentorEligibilityEnforced` false it is a NO-OP. With it true, in one transaction every active mentor/teaching membership that is not currently eligible is flipped `active -> inactive`, its pod links cleared (like the time-box sweep), and a system-actor `audit_entry` + `access_ledger` row (`event = membership.time_box_revoked`, `reason = eligibility_lapsed`) written. Deterministic injected `now`; **idempotent**; a `student` membership is never touched. Returns `{ revokedCount, revokedMembershipIds }`.

---

## 6c. Shared chapter calendar (guardian/director portal, Feature 1)

The director-authored, **audience-scoped** chapter calendar. A `chapter_director` authors a chapter's calendar of events, each tagged with the **audiences** (`parent` | `mentor` | `director`) that scope who may read it, and precise UTC timestamps. A `kind: "session"` event is the **source of truth for attendance** (Feature 2 reads its real `startsAt`/`endsAt` — the frontend stops hardcoding "Saturday 10:00").

**Append-only / auditable (platform invariant).** The calendar is an event-sourced revision log (`calendar_event`, migration `0026`): one row per `(event, revision)` with a stable `event_id` identity, a bumped `version`, a `status` (`active` | `canceled`), and the full field snapshot (including the `audiences[]` enum array — so every revision carries its own audience set for the trail). An **edit** is a new `active` revision; a **cancel** is a new `canceled` tombstone — never a destructive UPDATE or a hard DELETE (enforced by the shared `reject_append_only_mutation()` trigger + role REVOKE). Reads return the current non-canceled state via the `calendar_event_current` projection view (latest revision per `event_id`, carrying the **original** `createdBy`/`createdAt` forward). Every create/edit/cancel writes an `audit_entry` (`action = calendar.{created,edited,canceled}`) **and** an `access_ledger` row of the same event, **including the audience set** in `detail`.

**Event object** (all surfaces; timestamps ISO-8601 UTC):
```
{ id, chapterId, title, kind, startsAt, endsAt, audiences, location, notes, createdByAccountId, createdAt }
```
`id` is the **stable event identity** (the target of PATCH/DELETE), not the internal revision id. `kind ∈ {session, orientation, meeting, other}`; `audiences` is a non-empty subset of `{parent, mentor, director}`; `location`/`notes` are nullable. Lists are the `{ items: [event, ...] }` envelope.

**Capabilities (added to the registry with allow/deny fixtures):**
- **`calendar.manage`** — chapter-scoped **write**, `chapter_director` (`platform_admin` via override; a read-only `platform_staff` cannot). The three mutating routes are manifested against it.
- **`calendar.view`** — chapter-scoped **read floor**, roles `TEACHING` (`junior_mentor`, `senior_instructor`, `lead_instructor`, `chapter_director`), `writes:false` (both platform overrides reach it). `can` gates the role+scope floor; the **audience refinement is a service concern** on top: a non-director teaching member (a mentor) sees only `mentor`-audience events, while a **director of the chapter (or a platform reader) sees every audience**. `director`-tagged events are readable by the directors + `platform_admin` **of that event's chapter only**, never cross-chapter.
- **`guardian.view_calendar`** — guardian-scoped read (roles `[]`; the guardianship is the authority, matched against `ctx.guardianOf`), `writes:false`, no read-log (it returns a chapter schedule, not the composed minor record). Mirrors `guardian.view_digest`.

### `POST /api/ops/calendar` — create an event (`calendar.manage`)
- **Auth:** session — `calendar.manage`. Cross-chapter → opaque `403`.
- **Request body:** `chapterId` (required — must match the director's chapter, or admin override), `title` (required), `kind` (required), `startsAt` (required ISO), `endsAt` (required ISO — validated **strictly after** `startsAt`), `audiences` (required non-empty subset), `location?`, `notes?`.
- **Response `201`:** the created event object. **Errors:** `400` bad `kind`/`audiences` (empty or invalid)/`time_range`; `403`.

### `PATCH /api/ops/calendar/{id}` — edit (a new revision; `calendar.manage`)
- **Auth:** session — `calendar.manage`, resolved against the event's chapter (same-chapter check; another chapter → `403`).
- **Path param:** `id` (the `event_id`). **Body:** any subset of `title`, `kind`, `startsAt`, `endsAt`, `audiences`, `location`, `notes` (omitted fields keep the current revision's value; merged `endsAt > startsAt` enforced).
- **Response `200`:** the updated event (version bumped). **Errors:** `400`; `403`; `404` `CalendarEventNotFoundError`.

### `DELETE /api/ops/calendar/{id}` — cancel (a tombstone; `calendar.manage`)
- **Auth:** session — `calendar.manage`, same-chapter check.
- **Response `200`:** `{ id, status: "canceled", version }`. The event drops out of all reads; the prior revision **and** the tombstone both remain (append-only). **Errors:** `403`; `404`.

### `GET /api/ops/calendar?chapterId=` — the staff view (`calendar.view`; GET-exempt)
- **Auth:** session — `calendar.view`. A caller not staff of `chapterId` → opaque `403`; cross-chapter leakage is impossible (server-side membership check).
- **Query:** `chapterId` (optional — defaults to the caller's in-force teaching chapter(s)). Returns non-canceled events, **audience-filtered by the caller's role**: a mentor sees `mentor`-audience events; a director (or platform reader) sees every audience.
- **Response `200`:** `{ items: [event, ...] }`.

### `GET /api/guardian/calendar` — the guardian view (`guardian.view_calendar`; GET-exempt)
- **Auth:** session — `guardian.view_calendar`, matched against the guardian's verified children. A session with **no verified child** → opaque `403`.
- Resolves each verified child to their active chapter and returns the **`parent`-audience** non-canceled events across them, each tagged with its `chapterId` (a guardian with children in multiple chapters sees the **union**).
- **Response `200`:** `{ items: [event, ...] }`.

---

## 6d. Attendance & make-up check-ins (guardian/director portal, Feature 2)

Guardian-submitted, staff-resolved attendance exceptions over a chapter **session** (a `kind: "session"` `calendar_event` from Feature 1, referenced by its stable `event_id`/`sessionEventId` — the same id `GET /api/ops/calendar` returns as `id`). A guardian records that their child was **absent** or **late**; an absence carries a **make-up** (a 30-minute virtual check-in the student completes after finishing that session's assignment, scheduled **before the chapter's next session**), which a mentor/director later marks **done**.

**Append-only / auditable (platform invariant).** Attendance is an event-sourced revision log (`attendance_exception`, migration `0027`): one row per `(exception, revision)` with a stable `exception_id` identity, a bumped `version`, and the full snapshot (type, reason, `arrive_at`, `makeup_consent`, `makeup_slots[]`, `makeup_status`). A **make-up completion** is a **new revision** (`makeup_status → "completed"`) — never a destructive UPDATE or hard DELETE (enforced by the shared `reject_append_only_mutation()` trigger + role REVOKE). Reads return the current state via the `attendance_exception_current` projection (latest revision per `exception_id`, carrying the **original** guardian/`createdAt` forward). Every submission and completion writes an `audit_entry` **and** an `access_ledger` row (events `attendance.exception_submitted` / `attendance.makeup_completed`), `detail` carrying the `exceptionId`, `sessionEventId`, and `type` — never PII.

**Exception object** (all surfaces; timestamps ISO-8601 UTC):
```
{ id, studentAccountId, sessionEventId, type, reason, arriveAt, makeupConsent, makeupSlots, makeupStatus, createdByGuardianAccountId, createdAt }
```
`id` is the **stable exception identity** (the target of make-up-complete), not the internal revision id. `type ∈ {absent, late}`; `makeupSlots` is an array of ISO timestamps; `makeupStatus ∈ {pending, scheduled, completed}` for an absence and `null` for a late. `reason`/`arriveAt` are nullable (`arriveAt` is late-only).

**Counts envelope** (exact field names): `{ totalAbsences, outstanding, madeUp, late }` where `totalAbsences` = absences, `madeUp` = absences whose `makeupStatus = "completed"`, `outstanding` = `totalAbsences − madeUp`, `late` = late exceptions. The guardian read aggregates the child's exceptions across **all** terms; the staff `?chapterId=&termId=` roster scopes the counts to **one term** (a session's term is resolved by **date-range containment** — the term in the session's chapter whose `[starts_on, ends_on]` contains the session's `startsAt`, not the student's enrollment term).

**The make-up validation rule (server-side, never trusts the client).** Each chosen `makeupSlot` must be **strictly after** the missed session's `startsAt` (you cannot make up before missing) **and strictly before** the chapter's **next** `kind: "session"` event's `startsAt` (the next active, non-canceled session in the same chapter after the missed one). If there is **no next session** (the missed one is the last of the term), the fallback requires each slot to be **on or before** the term's `ends_on` (end of that day, UTC). An **absent** exception additionally requires `makeupConsent = true` **and at least one** valid slot; on submit it lands `makeupStatus = "scheduled"`. A **late** exception carries `arriveAt`, has **no** make-up (`makeupStatus = null`, `makeupSlots = []`, `makeupConsent` irrelevant).

**Capabilities (added to the registry with allow/deny fixtures):**
- **`attendance.submit`** — guardian-scoped **write** (roles `[]`; the guardianship is the authority, matched against `ctx.guardianOf`); `writes:true`, so the age-18 bar applies (a guardian cannot submit for an 18+ former child). Mirrors `consent.grant` / `publication.object`.
- **`attendance.view_child`** — guardian-scoped **read** (roles `[]`), `writes:false`, no read-log (attendance facts, not the composed minor record). Persists past the child's majority (ends at the edge's lapse).
- **`attendance.view`** — chapter-scoped **read floor**, roles `TEACHING` (`junior_mentor`, `senior_instructor`, `lead_instructor`, `chapter_director`), `writes:false` (both platform overrides reach it). The staff roster.
- **`attendance.resolve`** — chapter-scoped **write**, roles `TEACHING` (`chapter_director` + that chapter's mentors; `platform_admin` via override; a read-only `platform_staff` cannot). A **distinct** write capability from `attendance.view` — a read-only reader may view the roster but must not complete a make-up. The two mutating routes are manifested against `attendance.submit` / `attendance.resolve`.

### `POST /api/guardian/children/{id}/attendance` — submit an exception (`attendance.submit`)
- **Auth:** session — `attendance.submit`. `{id}` = the child's **student account id**; gated on the caller being the **verified guardian** of that child (a different guardian → opaque `403`).
- **Request body:** `sessionEventId` (required — the calendar session's `event_id`), `type` (required; `absent`|`late`), `reason?`, `arriveAt?` (ISO — late only), `makeupConsent?` (boolean — required `true` for an absence), `makeupSlots?` (array of ISO timestamps — required non-empty for an absence). *(Divergence from the shape list: `makeupConsent` is a body field so the consent-required-for-absent rule has an input; a late submit ignores it.)*
- **Validation:** the session must resolve to an active `kind:"session"` event **in the child's chapter** (a session in another chapter, or a nonexistent/canceled one, is one opaque `400`); slots after-missed and before-next-session (fallback: term `ends_on`); consent + ≥1 slot for an absence; `arriveAt` for a late.
- **Response `201`:** the created exception object. **Errors:** `400` bad `type`/`session`/`consent`/`slots`/`arrive_at`; `403`.

### `GET /api/guardian/children/{id}/attendance` — the child's exceptions + counts (`attendance.view_child`; GET-exempt)
- **Auth:** session — `attendance.view_child`, guardian-scoped to that child (another guardian's child → opaque `403`).
- **Response `200`:** `{ items: [exception, ...], counts: { totalAbsences, outstanding, madeUp, late } }`.

### `GET /api/ops/attendance` — the staff roster (`attendance.view`; GET-exempt)
- **Auth:** session — `attendance.view`. A caller not staff (teaching role) of the resolved chapter → opaque `403`; cross-chapter leakage is impossible (server-side membership check).
- **Query:** `?sessionEventId=` → who is absent/late for that one session (with pending make-ups); `?chapterId=&termId=` → the chapter's exceptions for that term (by date-range containment). Roster items carry the student `displayName` (first name + last initial — minor PII floor), never a raw last name/school.
- **Response `200`:** `{ items: [{ ...exception, displayName }, ...], counts: { totalAbsences, outstanding, madeUp, late } }`.

### `POST /api/ops/attendance/{id}/makeup-complete` — mark the check-in done (`attendance.resolve`)
- **Auth:** session — `attendance.resolve`, resolved against the exception's session chapter (same-chapter check; another chapter → `403`). `{id}` = the stable `exception_id`.
- **Behavior:** writes a **new** append-only revision with `makeupStatus → "completed"` (the prior revision is retained); the absence moves outstanding → made-up. **Idempotent** — completing an already-completed exception is a no-op (no new row). A **late** exception has no make-up and is refused.
- **Response `200`:** the completed exception object. **Errors:** `403`; `404` `AttendanceExceptionNotFoundError`; `409` `AttendanceMakeupNotApplicableError` (a late exception).

---

## 6e. Guardian ↔ chapter-staff messaging (guardian/director portal, Feature 3)

Threaded, append-only messaging between a **guardian** and their child's chapter's **staff** (the `chapter_director` + that chapter's mentors), retained like email. A guardian starts a thread or appends to their own; staff of the chapter list/read the threads and reply. Nothing is ever edited in place or deleted.

**Append-only / auditable (platform invariant).** A `message_thread` (migration `0028`) is **INSERT-once** — its chapter, guardian, subject, and creation time never change; a `message` is an **append-only** log (a correction is a NEW message, never an UPDATE). Both compose with the shared `reject_append_only_mutation()` trigger + SELECT/INSERT-only role grants. **`lastMessageAt` is DERIVED, not stored/mutated:** the `message_thread_current` projection computes it as `max(sent_at)` over the thread's messages (coalesced to `createdAt` when it has none yet), so it advances forward as replies append **without any destructive mutation** — the truly-immutable reading of "append-only" (an only-forward maintained column would need an UPDATE the trigger rejects, or a carve-out that forks the immutability guarantee). Every send / reply writes an `audit_entry` **and** an `access_ledger` row (events `message.sent` / `message.replied`), `detail` carrying the `threadId`, `messageId`, and server-derived `senderRole` — never the message body / any PII.

**`sender_role` is DERIVED SERVER-SIDE, never trusted from the client** (DB enum `message_sender_role` = `guardian|mentor|director`): a guardian send is always `guardian`; a staff reply is `director` (the replier holds a `chapter_director` membership in the thread's chapter) or `mentor` (a mentor tier — `junior_mentor`/`senior_instructor`/`lead_instructor`), read from the replier's in-force membership at send time (a `platform_admin` override with no chapter membership falls back to `director`). A client-supplied role in the body is ignored.

**Thread objects** (all surfaces; timestamps ISO-8601 UTC):
```
Message: { id, threadId, senderAccountId, senderRole, senderName, body, sentAt }
Thread:  { id, chapterId, guardianAccountId, subject, createdAt, lastMessageAt }
```
`senderName` is the sender's `account.display_name` (first name + last initial; senders here are adults — no minor last name leaks). Thread ids are opaque (no PII in URLs). The exact list/detail envelopes:
- **Guardian read** (`GET /api/guardian/messages`): `{ items: [{ ...Thread, messages: [Message, …] }] }` — each thread with its full message list nested, newest-activity-first.
- **Staff list** (`GET /api/ops/messages`): `{ items: [{ ...Thread, guardianName, lastMessage: Message | null }] }` — a `lastMessage` PREVIEW (not nested), plus the guardian's display name, newest-activity-first.
- **Staff detail** (`GET /api/ops/messages/{threadId}`): `{ ...Thread, guardianName, messages: [Message, …] }` — the full message list.
- **Send / reply** return the created **Message** object (which carries its `threadId`).

**Multi-chapter disambiguation (new thread).** A NEW thread's `chapterId` is resolved from the guardian's **verified child** (guardianship → active membership → chapter). A guardian with children in **several** chapters must say which one: `childAccountId` (preferred — it also anchors the guardian scope) or `chapterId` picks it; with a single eligible chapter neither is needed; with several and neither given it is an ambiguous **`400`**. The chosen chapter must be one the guardian has a verified child in — a `chapterId`/`childAccountId` the guardian has no verified child in resolves to no anchor and **denies opaque `403`** (a guardian cannot open a thread in a chapter they have no child in).

**Capabilities (added to the registry with allow/deny fixtures):**
- **`message.send`** — guardian-scoped **write** (roles `[]`; the guardianship is the authority, matched against `ctx.guardianOf`); `writes:true`, so the age-18 bar applies. The "own thread" (append) and "a chapter the guardian has a child in" (create) bounds are service concerns on top of the guardian scope.
- **`message.view_own`** — guardian-scoped **read** of the guardian's OWN threads (roles `[]`), `writes:false`, no read-log. Persists past the child's majority (ends at the edge's lapse).
- **`message.view`** — chapter-scoped **read floor**, roles `TEACHING`, `writes:false` (both platform overrides reach it). The staff thread list + detail.
- **`message.reply`** — chapter-scoped **write**, roles `TEACHING` (`chapter_director` + that chapter's mentors; `platform_admin` via override; a read-only `platform_staff` cannot). A **distinct** write capability from `message.view` — a read-only reader may view a thread but must not post. The two mutating routes are manifested against `message.send` / `message.reply`.

> **Compliance note (COPPA 1.8 / § 312.2).** The platform's no-direct-messaging guard (a CurioLab username stays non-PII because a student cannot be contacted by username) is preserved: this channel is **adult-to-adult** (a guardian and their child's chapter's staff), never student-directed — a student is neither a sender (no `student` role, guardian scope) nor a recipient (a thread is keyed on the guardian + chapter, never a student). The `directMessagingCapabilities` guard now exempts exactly this shape (guardian scope, or chapter/pod scope with a non-empty staff-only roles floor); a student-facing `message.*` capability still trips it.

### `POST /api/guardian/messages` — guardian sends (`message.send`)
- **Auth:** session — `message.send`. Guardian-scoped (matched against `ctx.guardianOf`); a cross-guardian / no-child caller → opaque `403`.
- **Request body:** `body` (required, non-empty), `threadId?` (append to the caller's OWN thread; else create), `subject?` (new thread only), `childAccountId?` / `chapterId?` (disambiguate a new thread's chapter for a multi-chapter guardian). `sender_role` is **not** a body field — it is derived server-side (`guardian`).
- **Response `201`:** the created **Message** (carrying `threadId`). **Errors:** `400` empty `body` / ambiguous new-thread chapter; `403` another guardian's thread, or a chapter the guardian has no child in; `404` unknown `threadId`.

### `GET /api/guardian/messages` — the guardian's threads + messages (`message.view_own`; GET-exempt)
- **Auth:** session — `message.view_own`, guardian-scoped. A session with no verified child → opaque `403`.
- **Response `200`:** `{ items: [{ ...Thread, messages: [Message, …] }] }`.

### `GET /api/ops/messages?chapterId=` — the staff thread list (`message.view`; GET-exempt)
- **Auth:** session — `message.view`. A caller not staff of `chapterId` → opaque `403`; cross-chapter leakage is impossible (server-side membership check). `chapterId` optional (defaults to the caller's in-force teaching chapter(s)).
- **Response `200`:** `{ items: [{ ...Thread, guardianName, lastMessage: Message | null }] }`.

### `GET /api/ops/messages/{threadId}` — one thread, full messages (`message.view`; GET-exempt)
- **Auth:** session — `message.view`, resolved against the thread's chapter (same-chapter check; another chapter → `403`).
- **Response `200`:** `{ ...Thread, guardianName, messages: [Message, …] }`. **Errors:** `404` unknown thread; `403` cross-chapter.

### `POST /api/ops/messages/{threadId}/reply` — mentor/director reply (`message.reply`)
- **Auth:** session — `message.reply`, resolved against the thread's chapter (same-chapter check; another chapter → `403`).
- **Request body:** `body` (required, non-empty). `sender_role` is derived from the replier's membership (`director` / `mentor`).
- **Response `201`:** the created **Message**. **Errors:** `400` empty `body`; `403` non-staff / cross-chapter; `404` unknown thread.

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

## 10. Mentor-student direct messaging (Phases 1–4 — REVIEW-GATED, built DARK, FULLY BUILT)

The highest-risk surface in the platform (adult-to-minor messaging). Built fully against **synthetic data**, **OFF by default** behind the global build flag `MENTOR_DM_ENABLED` (default `false`, `=== 'true'`) and **COUNSEL-GATED** (the design doc Part A/B legal sign-off). With the flag off, `canDirectMessage` returns false and **no DM send is accepted — no real minor can be a party**. See `docs/platform/plans/mentor-student-dm-design.md`. All four build phases are complete: Phase 1 setup + provisioning, Phase 2 structural constraints, Phase 3 detection + oversight, and **Phase 4 the participant + guardian surfaces (send/read, onboarding, report, guardian read/digest)** — the feature is fully built and dark.

The runtime pair gate is the pure predicate **`canDirectMessage(mentor, student, now)`** (`@curiolab/core`), re-evaluated at every send/read, true only when ALL hold: the student is in a pod the mentor is assigned to in the current term; a current (non-expired, non-revoked) `mentor_dm` consent grant is on file; `evaluateMentorEligibility` passes; the chapter DM switch is on; and `MENTOR_DM_ENABLED` is on.

### `POST /api/ops/safety-officers` — assign a chapter's safety officer

- **Auth:** session; capability `safety_officer.assign` (chapter-scoped, `chapter_director`; `platform_admin` via override).
- **Request:** `{ chapterId, accountId }`.
- **Behavior:** records the target account as the chapter's **independent** safety officer (design C.1). Refuses the **not-a-peer** case — the target may not already be a mentor/teaching or student in that chapter — at the service **and** a DB trigger backstop.
- **Response `201`:** `{ membershipId, chapterId, accountId }`.
- **Errors:** `403` opaque (not a director); `409` `SafetyOfficerPeerConflictError` (the target is a peer in that chapter).

### `POST /api/ops/dm/attestations` — record the insurance attestation

- **Auth:** session; capability `dm.enable` (chapter-scoped, `chapter_director`; `platform_admin` via override).
- **Request:** `{ chapterId, carrier?, policyRef? }`.
- **Behavior:** records that abuse-and-molestation insurance is confirmed for the chapter (a Part D enable precondition). Append-only.
- **Response `201`:** `{ attestationId, chapterId }`.
- **Errors:** `403` opaque.

### `POST /api/ops/dm/enable` — flip the chapter DM switch on

- **Auth:** session; capability `dm.enable`.
- **Request:** `{ chapterId }`.
- **Behavior:** turns DM on for the chapter (design Part D). **Refuses** unless, in the system: a `safety_officer` is assigned to the chapter; an insurance attestation is on record; and the chapter has ≥1 current-term pod. Idempotent. Even after enabling, the global `MENTOR_DM_ENABLED` flag must also be on for any DM to flow.
- **Response `201`:** `{ chapterId, alreadyEnabled }`.
- **Errors:** `403` opaque; `409` `DmEnablePreconditionError` with `reason` ∈ `no_safety_officer | no_insurance_attestation | no_current_term_pod`.

### `POST /api/guardian/children/{id}/dm-consent` — capture the mentor_dm signed-form consent

- **Auth:** session; capability `consent.grant` (guardian-scoped over the named verified child). Reuses `ConsentGrantService` — no forked write authority.
- **Path param:** `id` (the child account id).
- **Request:** `{ evidenceArtifactRef, scope? }`. Method is fixed to `signed_form`.
- **Behavior:** captures the `mentor_dm` consent grant (design C.3/C.10) — a **signed form** with a non-null evidence artifact. A click / missing artifact is **refused** at the service **and** a DB trigger backstop. Expires at term end; independently revocable via the existing per-grant revoke (`POST /api/guardian/children/{id}/grants/mentor_dm/revoke`).
- **Response `201`:** `{ grantId, subjectStudentAccountId, grantType: "mentor_dm", method, expiresAt, renewal }`.
- **Errors:** `403` opaque; `400` `GrantSignedFormRequiredError` (weak method / no artifact).

### Phase 2 — structural constraints (built DARK)

Phase 2 adds the design C.4/C.5/C.11 structural constraints over the Phase 1 store. All remain dark behind `MENTOR_DM_ENABLED`.

**Closed hours (C.4).** A DM **send** is refused outside the chapter's allowed **local** window — default **07:00–21:00**, `[open, close)` in the chapter's `timezone`. A chapter may override per-chapter via `chapter.dm_open_hour` / `dm_close_hour` (migration 0031; NULL = use the config default `dmOpenHourDefault` / `dmCloseHourDefault`). The window is checked deterministically against an injected `now` in the chapter timezone (never an uncontrollable clock). **Reads are never hours-gated.** A closed-hours send throws `DmClosedHoursError` (→ `409`) and writes nothing. This gates sends only (which already require the flag on), so it is dark.

**Off-platform contact-info flagging (C.4/C.5).** A pure, data-driven detector (`detectDmContentFlags`, `@curiolab/core`) finds contact-info patterns in a draft body — phone, email, social handle, off-platform URL (category `contact_info`). It is data-driven so Phase 3 extends it (secrecy framing, in-person arrangements, …) without a rewrite. Two uses:

- On an actual **send**, a match records an append-only `dm_flag` row (`{ id, thread_id, message_id, category, detail, created_at }`; migration 0031) routed to the safety officer's Phase-3 queue. `detail` is the matched **kind** (e.g. `email`), never the raw plaintext match (the body is encrypted at rest). This does **not** block the send — friction, not a block. The detector runs on the **plaintext** at send time, never against ciphertext.
- `POST /api/dm/check-draft` — the **pre-send check** for the frontend's interstitial. Session-gated; runs the pure detector over `{ body }` and returns `{ flags: [{ category, detail }] }` **without sending**. Writes nothing and calls no `authorize` (**inert** in the route manifest; POST only because the draft travels in the body).

**Thread export (C.4).** `GET /api/dm/threads/{threadId}/export` — export the **full decrypted** thread, scoped so **only** the **student** (their own thread) or a **verified guardian** of that student may export; the mentor, the safety officer, a stranger, or another chapter get an opaque `403`. Returns `{ generatedAt, thread: { id, chapterId, mentorMembershipId, studentAccountId, visibilityHeader, createdAt }, messages: [{ id, seq, senderAccountId, body, sentAt }] }` in `seq` order. A read of already-authorized data (GET, read-exempt from the manifest), but **dark-gated**: with `MENTOR_DM_ENABLED` off it refuses (`DmNotAuthorizedForPairError` → `409`) — there are no real threads anyway.

**Retention carve-out (C.11).** DM threads and messages are **excluded** from deletion-request fulfillment (`DeletionFulfillmentService.fulfillDeletion`) and retained to the outer bound of the limitations window — config `DM_RETENTION_MS` (a **placeholder** pending counsel; working assumption ~age 30). The fulfill path never enumerates `dm_thread`/`dm_message`, so a subject's DM logs are preserved even when the rest of their record is erased/anonymized (the append-only trigger already forbids deleting them); the fulfillment audit records `dmThreadsRetained` so the exclusion is explicit and observable. This is a deliberate carve-out from the right-to-deletion policy, disclosed at consent (design C.10).

### Phase 3 — detection & oversight (built DARK)

Phase 3 adds the design C.5–C.8/C.15 detection-and-oversight layer over the Phase 1/2 store (migration `0032`; all append-only). Everything remains dark behind `MENTOR_DM_ENABLED` — every service below refuses (`DmNotAuthorizedForPairError` → `409`) with the flag off.

**Content-flag categories (C.5).** `DM_CONTENT_MATCHERS` (`@curiolab/core`) now covers, beyond Phase 2's `contact_info`: `secrecy_framing` (don't tell / between us / our thing / delete this), `in_person_arrangement` (meeting outside program events, rides, gifts), `romantic_appearance` (romantic / appearance-focused language), and `home_life_probing` (probing home life as isolation-testing). On a send, **every** matched category writes one append-only `dm_flag` (`detail` = the matched **kind**, never raw text) **and** appends a `dm.flag_raised` monitoring-ledger entry. Flags never block a send; they route to the reading queue.

**Full-coverage reading queue (C.6).** `GET /api/ops/dm/queue?chapterId=…` (`dm.oversee`, safety-officer, GET read-exempt) — the **complete chronological, decrypted** queue for the officer's chapter with **flagged items pinned** to the top, plus per-thread coverage and the weekly-volume transition flag. **Not** a ranked sample (behavioral ranking is a documented, scale-triggered future capability). Returns `{ items: [{ threadId, messageId, seq, senderAccountId, body, sentAt, flagged, flags }], threads: [{ threadId, studentAccountId, mentorMembershipId, totalMessages, readMessages, unreadMessages, guardianEverOpened }], weeklyMessageCount, maxWeeklyMessages, overFullReviewThreshold }`. Reading the queue appends one `dm.read_by_officer` monitoring-ledger entry per thread. `guardianEverOpened` is a **separate** guardian-supervision signal (drives a guardian nudge) — explicitly **not** a mentor risk score (there is none in v1). A non-officer / another chapter's officer gets an opaque `403`.

**Read-receipts + coverage (C.6).** `POST /api/ops/dm/threads/{threadId}/read` (`dm.oversee`) — records an append-only `dm_read_receipt` up to the thread's latest `seq` + a `dm.receipt_recorded` ledger entry. Coverage is **computed**: a message is "read" iff its `seq ≤ max(up_to_seq)` for the thread, so a mark-read yields **100% coverage**. `DM_FULL_REVIEW_MAX_WEEKLY_MESSAGES` (a clearly-labelled placeholder) is the weekly-volume threshold above which full review is deemed infeasible and sampling/ranking would be **designed** (not built now); `overFullReviewThreshold` exposes whether the chapter is over the line.

**Monitoring ledger + officer oversight (C.7).** Every officer read, guardian read, flag raise/review, receipt, and suspension step appends to the append-only `access_ledger` (new events: `dm.read_by_officer`, `dm.read_by_guardian`, `dm.flag_raised`, `dm.flag_reviewed`, `dm.receipt_recorded`, `dm.visibility_{suspended,acknowledged,revoked,restored}`, `dm.thread_frozen`). The officer **cannot modify** it (append-only: role REVOKE + trigger — no update/delete path exists). `POST /api/ops/dm/flags/{flagId}/review` (`dm.oversee`) records a disposition (append-only `dm_flag_review`). `GET /api/ops/dm/oversight-report?chapterId=&from=&to=` (`dm.oversee`, GET read-exempt) is the **quarterly board export**: `{ chapterId, from, to, totalMessages, readMessages, coverageRatio, flagsRaised, flagsReviewed, flagsByCategory, dispositions, suspensionsInitiated }`.

**Two-adult guardian-visibility suspension (C.8).** Guardian standing read access is suspendable **only** by the safety officer, through a guarded, append-only, event-sourced flow (`dm_visibility_suspension`; per-**student** by default, `thread_id` optional to narrow — chosen because guardian standing access is a property of the guardian↔student relationship, not one conversation).
- `POST /api/ops/dm/suspensions` (`dm.suspend_guardian_visibility`) — **initiate**. Requires a recorded `reason` (else `DmSuspensionReasonRequiredError` → `400`). Records a 90-day expiry (`DM_VISIBILITY_SUSPENSION_MS`) and surfaces + records the **mandatory-reporter checkpoint** (`reporter_checkpoint_ack`), returning `{ suspensionId, expiresAt, reporterCheckpoint: { title, body, ohioHotline } }` (the Ohio hotline text is a placeholder pending confirmation). It does **not** take effect yet.
- `POST /api/ops/dm/suspensions/{id}/acknowledge` (`dm.acknowledge_visibility_suspension`, chapter director / another safety officer) — the **second adult** acknowledges, bringing it into effect. The service enforces the acknowledger is **not a mentor in the chapter** (`is_mentor_in_chapter`) and is **distinct from the initiating officer** (`same_as_initiator`) — both `DmSuspensionSecondAdultInvalidError` → `409`; a pure mentor never reaches the service (opaque `403` at the capability floor).
- While **active** (acknowledged, unexpired, non-revoked) the guardian is removed from the four-party read/party-check — they cannot read; the mentor/student/safety-officer parties are unaffected. It **auto-restores** after 90 days (computed against `now`; no fresh initiation ⇒ the guardian reads again), never silently. Every step logs to the monitoring ledger.

**Mentor-departure freeze (C.15).** `runDmFreezeOnDeparture(sql, { mentorMembershipId, handoffDecision, reason?, frozenByAccountId?, now? })` — a sweep-composable service step (no HTTP route) that writes an append-only `dm_thread_freeze` row (one per thread) for a departed mentor's threads, recording the **handoff decision** (successor mentor / paused / safety-officer conversation — a recorded field, not improvised). A frozen thread **rejects new sends** (`DmThreadFrozenError` → `409`, even if the pair is later re-enabled) but **still reads** for the authorized parties and is **never deleted**. `canDirectMessage` already goes false on the mentor's revoke; the freeze adds the preserve semantics on top.

### Phase 4 — participant & guardian surfaces (built DARK)

Phase 4 adds the design C.2/C.10/C.12 participant + guardian HTTP surfaces over the Phase 1–3 store (migration `0033` adds two append-only tables: `dm_onboarding_ack`, `dm_report`). Everything remains dark behind `MENTOR_DM_ENABLED` — **every** route below refuses (`DmNotAuthorizedForPairError` → `409`) with the flag off. New capability: `dm.report` (participant floor, `pairGated`). New ledger event: `dm.student_report`.

**Participant send (C.2).** `POST /api/dm/messages` (`dm.message`) — a mentor **or** the student sends within an **authorized pair**. Body `{ mentorMembershipId, studentAccountId, chapterId, body }`. The service enforces `canDirectMessage` (assignment + `mentor_dm` consent + eligibility + chapter switch + global flag) plus the Phase-2 closed-hours + frozen + content-flag checks, stores the **encrypted** body, and returns `{ threadId, messageId }` (`201`). A student may only send in their own thread; a mentor only in an assigned pair; everyone else `403`.

**Participant list + read (C.2).** Both carry the permanent **visibility header** and the plain **who-can-read** statement (`DM_WHO_CAN_READ_TEXT`).
- `GET /api/dm/threads` (participant, GET read-exempt) — the caller's **own** threads (a student sees their thread(s); a mentor sees the pairs they are assigned). Returns `{ items: [{ threadId, chapterId, mentorMembershipId, studentAccountId, visibilityHeader, whoCanRead, lastMessageAt, messageCount }] }`.
- `GET /api/dm/threads/{threadId}` (party-gated, GET read-exempt) — one thread with its **decrypted** messages, gated by the suspension-aware four-party party check (a suspended guardian is excluded; participants + safety officer + non-suspended guardian admitted). Returns `{ threadId, chapterId, mentorMembershipId, studentAccountId, visibilityHeader, whoCanRead, messages: [{ id, seq, senderAccountId, body, sentAt }] }`. A non-party gets an opaque `403`.

**First-open onboarding (C.12).** Shown the first time a student opens any thread: who reads this, what happens when you report, and that reporting does not get anyone in trouble by default (a backend constant `DM_ONBOARDING`).
- `GET /api/dm/onboarding` (participant, GET read-exempt) — `{ content: { title, whoReads, reporting, noTrouble }, acknowledged, acknowledgedAt }`.
- `POST /api/dm/onboarding/ack` (`dm.read_own`) — records an append-only `dm_onboarding_ack` (idempotent; the earliest ack is the record). Returns `{ acknowledged: true, acknowledgedAt }` (`201`).

**"Something feels off" report (C.12).** `POST /api/dm/threads/{threadId}/report` (`dm.report`) — a participant files a low-key report. Body `{ note? }`. Gated by the party check on top of `dm.report`; a non-party gets an opaque `403`. Writes an append-only `dm_report` **and** a `dm.student_report` monitoring-ledger entry. It **routes to the safety officer and does NOT notify the mentor** — nothing is written to the thread (no `dm_message`, no `dm_flag`), and the mentor has **no read path** to `dm_report` or the ledger. Returns `{ reportId, threadId }` (`201`). The officer reads reports at `GET /api/ops/dm/reports?chapterId=…` (`dm.oversee`, GET read-exempt) → `{ items: [{ reportId, threadId, reporterAccountId, note, createdAt }] }`; a non-officer / the mentor gets an opaque `403`.

**Guardian read + digest (C.10).** Guardian-scoped to their **own verified child**; another child / a lapsed edge is an opaque `403`; suspension-aware.
- `GET /api/guardian/children/{id}/dm` (GET read-exempt) — the child's threads, **decrypted**, each with the visibility header + who-can-read; an **active** visibility suspension excludes the guardian from a thread. Returns `{ items: [ { threadId, chapterId, mentorMembershipId, studentAccountId, visibilityHeader, whoCanRead, messages } ] }`. (Full-thread **export** already exists at `GET /api/dm/threads/{threadId}/export`, reachable by the student or a verified guardian.)
- `GET /api/guardian/children/{id}/dm/digest` (GET read-exempt) — the weekly digest **data**: `{ childAccountId, generatedAt, since, threadCount, messageCount, flagCount, flagsByCategory }`, aggregated over **only** that child's visible threads since the last digest (~7 days). The email itself is frontend-owned (Resend); this exposes the data.

**The DM feature is now FULLY BUILT and DARK** (`MENTOR_DM_ENABLED=false`), pending the board (Part A), counsel (Part B), and insurer sign-off and every Part D enable-precondition before any enable.

---

## Deferred / placeholder notes

- **Ops list/GET endpoints (P1).** The director-portal reads in §6a now exist (`GET /api/ops/{applications,applications/[id],invites,memberships,guardianships,media/review-queue,deletion-requests,export-requests,enrollments,pods,terms,dashboard}`), backed by the framework-agnostic `OpsReadService` (`packages/app/src/ops-read.ts`) and gated on the new chapter-scoped read capabilities. The moderation queue read (`GET /api/lab/moderation/queue`) and the audit readers read directly (no dedicated service read method). Guardian and profile reads are the composed-record endpoints above.
- **Placeholder response fields:** `ChildRecord.mentorHours`/`.timeline`, `ProfileView.mentorHours`/`.timeline`, `ChapterDigest.items`, and `ExportBundle.timeline` are honest zero-state placeholders pending later milestones.
- **Mailer seams:** tokens returned "once" (`IssueInviteResult.token`, `ReissueSetupResult.token`, `CreateStudentLinkResult.studentToken`, `RegenerateVerificationResult.token`) and the password-reset / subscriber confirm/unsubscribe tokens are the seams a future mailer consumes; delivery itself is deferred.
- **`GET /api/auth/session`** returns `401 {"error":"unauthorized"}` on no session (it is a public controller), unlike the opaque `403` used by `runAuthed` routes — front-end code should treat both as "not signed in".
