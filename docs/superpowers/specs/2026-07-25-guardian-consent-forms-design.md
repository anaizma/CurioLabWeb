# Guardian Consent Forms — Design

**Date:** 2026-07-25
**Status:** Approved (pending spec review)
**Branch:** feat/platform-m1

## Problem

The parent portal's consent tab (`app/portal/parent/consent/`) is a pure mock:
grant-status cards with fake "Upload signed form" / "Withdraw" buttons, fed by
`lib/portal/guardian/sample.ts`, with no persistence and no real forms.

We are replacing it with a real guardian-facing flow for **completing CurioLab's
consent forms**: read each form as a display-only PDF, complete the consent
controls in the app layer (checkboxes, typed fields, drawn signature), remember
values across forms (browser-autofill style), and persist an immutable per-form
audit record. Completing a form drives the existing append-only `consent_grant`
ledger, so the grant-status cards become real.

## Source material

Forms 00–11 (Markdown, attorney-review drafts). Form 00 is master terms /
reference only (never signed). Forms 01–11 each become a viewable PDF.

Audience differs by form and determines where the completion UI mounts:

| Forms | Audience | Portal | This build |
|---|---|---|---|
| 01–07 | Guardian | Parent portal | **Live completion UI (mounted)** |
| 08 (Mentor Conduct), 09 (Background Check), 10 (Volunteer Agreement) | Mentor/Director (adult self) | Mentor/Director portal | Catalogued + PDF only (mount deferred) |
| 11 (Age of Majority Transfer) | Student (now adult, self) | Student portal | Catalogued + PDF only (mount deferred; uses `selfGrant`) |

## Decisions (settled with the user)

1. **Work on `feat/platform-m1` directly** (tree confirmed clean).
2. **Full architectural fit** — real Drizzle migration + `packages/app` service +
   `packages/http` controllers + Next route handlers, matching the `consent_grant`
   ledger conventions (migration 0024).
3. **Drive the grant ledger** — submitting a form captures the mapped grant(s) via
   the existing `ConsentGrantService.captureGrant`, so the consent-tab cards reflect
   real `granted / needs-form / revoked / expiring` status.
4. **Pre-generate PDFs at build time**, committed, with pinned content hashes.
5. **Form scope**: engine + catalog cover all 11; only guardian Forms 01–07 get a
   live mounted UI now. 08–11 catalogued, portal mounts deferred.
6. **Signatures live in an app-owned Postgres store** (immutable per-completion copy
   + a mutable remembered copy per guardian). Never exposed to third parties.
7. **PDF viewer**: `react-pdf`/pdf.js behind a swappable `<FormViewer>` (reliable
   cross-device paging; finger signature means mobile matters).
8. **Drafts**: a small mutable server-side draft table (resume survives device/account
   switch).

## Architecture

Everything is **additive**. No existing table, view, service, controller, route, or
capability is modified. The `consentGrantLedgerEnforced` flag stays OFF — capture and
revoke always write the ledger (as today); only the publish-gate *enforcement* is
flagged, unchanged by this work.

### Data flow

```
content/consent-forms/Form-NN.md  ──generate-pdfs.mjs──▶  public/consent-forms/form-NN.pdf  (display-only)
                                   └────────────────────▶  packages/app/src/consent-forms/pdf-hashes.json  (pinned sha256)

Guardian opens form
  → reads PDF (<FormViewer>, react-pdf)
  → app-layer controls: checkboxes (unchecked = explicit "no"), typed fields, signature canvas
  → autofill suggestion chips from saved-fields (one-tap accept/edit, never silent)
  → [Elevated forms only] swappable VerificationStep (stubbed) — a reused signature never satisfies it
  → Submit (blocked until required items checked + required fields filled)
      → POST completion
          server (one tx):
            validate item/field completeness vs the form version
            re-hash served PDF bytes, assert == pinned sha256
            if elevated: require verification result (strong method + evidence)
            insert consent_signature (own bound row) + consent_form_completion (append-only)
            upsert guardian_saved_field for each typed value + signature
            for each grantMapping: ConsentGrantService.captureGrant({ method, evidenceArtifactRef = completionId })
      → consent-tab grant cards reflect real status
```

## Component 1 — PDFs & catalog

### Source + generator
- Commit `content/consent-forms/Form-00..11-*.md` (00 reference).
- `scripts/consent-forms/generate-pdfs.mjs` using **pdfkit** (pure JS, no native
  binaries). Renders each Markdown form → `public/consent-forms/form-NN.pdf`. The
  PDF info dict is pinned (no `CreationDate`, no file `ID`, fixed `Producer`) so
  output bytes are **deterministic** and hashes are reproducible.
- Emits `packages/app/src/consent-forms/pdf-hashes.json` (`{ "form-02": "<sha256>", ... }`).
- Run ahead of build and committed; `next build` only serves the committed static
  assets. A determinism test regenerates and asserts the hash matches the committed
  file / pinned value.

### Server catalog (authoritative)
`packages/app/src/consent-forms/catalog.ts`. Per form:
- `formId` ("form-02"), `documentId` ("CL-CONSENT-02"), `version` ("2026.03"),
  `title`, `audience` ("guardian" | "mentor" | "student"), `pdfPath`, `pdfSha256`
  (from `pdf-hashes.json`), `elevated` (form-level).
- `items[]` — **auto-parsed** from the `- [ ]` clauses: `{ itemKey (stable), text }`.
- **Curated overlay** per item: `required`, `grantMapping?` (which
  `ConsentGrantType` this item contributes to), per-item `elevated?`. Parsing gives
  clause identity; counsel/curation decides required + grant semantics.
- `fields[]` — the fill-in blanks: `{ fieldType (autofill key: guardian_name,
  relationship, date, child_name, child_dob, guardian_email, guardian_phone,
  second_contact, ... ), label, inputType (text|date|tel|email), required }`.

The **client never imports the catalog**. A client-safe schema projection (items,
fields, required, elevated, pdfPath, hash — no grant mappings) is delivered by the
forms API.

### Form → grant mapping (curated, in the catalog overlay)
Maps guardian forms to `consent_grant_type` values. Illustrative (final mapping is
catalog data, reviewed with the annex of each form):
- Form 01 → `program_participation`, `platform_account` (+ chapter-visibility option).
- Form 02 → `public_publication` (Elevated).
- Form 03 → `photo_video_likeness` (public sub-items Elevated).
- Form 04 → `mentor_dm` (Elevated, `signed_form`-required).
- Form 05 → `verification_link_sharing`.
- Forms 06 + 07 → `emergency_medical_pickup` (both contribute).
- Forms 08–10 → adult agreements, no child-subject grant (mount deferred).
- Form 11 → `selfGrant` re-confirmation of persisting grants (mount deferred).

## Component 2 — Data model (migration `0039`)

House style follows migration 0024: append-only trigger
(`reject_append_only_mutation()`), Mechanism-A role grants
(`curiolab_app` / `curiolab_rls` SELECT+INSERT; analytics denied), `seq` bigserial,
red-state test witnessed at `CURIOLAB_MIGRATE_UPTO=0038`. Drizzle schema mirrors the
DDL in `packages/db/src/schema.ts`.

### `consent_form_completion` — append-only, immutable (the evidence artifact)
```
id uuid pk, seq bigserial unique,
form_id text not null, form_version text not null,
pdf_sha256 text not null,
subject_student_account_id uuid refs account (null for adult/self forms),
signer_account_id uuid not null refs account,
audience text not null,
item_states jsonb not null,      -- { itemKey: boolean } for EVERY item (unchecked = explicit false)
field_values jsonb not null,     -- { fieldType: string }
signature_ref uuid not null refs consent_signature,
verification jsonb,              -- { method, evidenceArtifactRef, ... } for elevated; null otherwise
submitted_at timestamptz not null default now(),
created_at timestamptz not null default now()
```
Reconstructs a completed form exactly as signed. Its `id` is the
`evidence_artifact_ref` written onto the captured grant(s).

### `consent_signature` — append-only, immutable
```
id uuid pk, seq bigserial unique,
completion_id uuid not null,     -- the parent completion's PRE-GENERATED id (set at insert)
image bytea not null,            -- PNG bytes of the drawn/reused signature
width int, height int,
captured_at timestamptz not null default now(),
binding jsonb not null,          -- { formId, formVersion, pdfSha256, timestamp }
created_at timestamptz not null default now()
```
Every submit writes its **own** row. Reuse copies bytes into a fresh bound record —
never an automatic stamp across forms.

**Write order (both tables append-only, so no backfill UPDATE):** the service
pre-generates the completion `id` (uuid), inserts `consent_signature` with
`completion_id` = that id, then inserts `consent_form_completion` with `id` = that id
and `signature_ref` = the signature's id. The mutual reference is satisfied at insert
time; neither row is ever updated.

### `guardian_saved_field` — mutable, per guardian (autofill store)
```
guardian_account_id uuid not null refs account,
field_type text not null,
value_text text,                 -- typed fields
value_blob bytea,                -- signature bytes (field_type = 'signature')
updated_at timestamptz not null default now(),
primary key (guardian_account_id, field_type)
```
Upsert on submit. Explicit scope: the acting guardian's own account, app store only.

### `consent_form_draft` — mutable, per (guardian, child, form)
```
guardian_account_id uuid not null refs account,
subject_student_account_id uuid refs account,
form_id text not null,
item_states jsonb, field_values jsonb, signature bytea,
updated_at timestamptz not null default now(),
primary key (guardian_account_id, subject_student_account_id, form_id)
```
Debounced upsert while editing; deleted (or ignored) once a completion exists.

## Component 3 — Service (`packages/app`)

`ConsentFormService` (framework-agnostic; `sql`, `authorize`, `config`, injectable
`now` — same shape as `ConsentGrantService`):

- `listForms(childId, ctx)` → per form: client schema + status
  (`not_started | in_progress | complete`, derived from completions + drafts) +
  required flag. Authorized under existing `guardian.view_grants` (child-scoped).
- `getSavedFields(ctx)` → remembered typed values + remembered signature bytes for
  the acting guardian.
- `getDraft` / `saveDraft(childId, formId, ctx, payload)` → resume support.
- `submitCompletion(formId, childId, ctx, { itemStates, fieldValues, signature, verification }, now?)`:
  1. Validate every required item checked, every required field present, item keys
     match the form version (reject unknown/missing keys).
  2. Read the committed PDF bytes, sha256, **assert == catalog `pdfSha256`** (binds
     the audit to the exact bytes shown).
  3. If the form/any checked item is Elevated: require a verification result with a
     strong method + evidence. **A reused signature alone is rejected here** (belt to
     `captureGrant`'s DB-backed floor).
  4. In one tx: insert `consent_signature` (bytes + binding) → insert
     `consent_form_completion` (append-only, `signature_ref`) → upsert
     `guardian_saved_field` for each typed value + the signature → for each
     `grantMapping` call `ConsentGrantService.captureGrant({ method,
     evidenceArtifactRef: completionId, scope })`. Standard method = `click`;
     Elevated = `signed_form` / strong. Access-ledger rows via the existing helpers
     (captureGrant already writes them).
  5. Delete the draft.
- Revocation stays the existing `revokeGrant` / revoke route (Withdraw button).

Reuses the existing `consent.grant` write capability and `guardian.view_grants` read
capability. No new authorize-core capability unless review reveals a gap; if needed,
add one additively mirroring the §5 guardian reads.

## Component 4 — HTTP + routes

Controllers in `packages/http/src/controllers/consent-forms.ts` (thin adapters over
the service, same shape as `guardian.ts`), wired to Next route handlers using the
repo's Next 16 conventions (`RouteContext<...>`, `await ctx.params`, async
`cookies()`). **Read `node_modules/next/dist/docs/` before writing handlers**
(AGENTS.md).

- `GET  /api/guardian/children/:id/forms`
- `GET  /api/guardian/forms/saved-fields`
- `GET  /api/guardian/children/:id/forms/:formId/draft`
- `PUT  /api/guardian/children/:id/forms/:formId/draft`
- `POST /api/guardian/children/:id/forms/:formId/completions`
- `GET  /api/guardian/children/:id/forms/:formId/completions/:completionId` (audit)
- PDFs served statically from `/public/consent-forms/` (no handler).

## Component 5 — Web UI (parent portal)

Replaces `app/portal/parent/consent/consent-client.tsx`. New structure:

- **`page.tsx`** (server) → fetch forms list + saved fields via a server data fn
  mirroring `lib/portal/guardian/guardian-data.ts` (reads `cl_session`, calls the
  API, falls back to sample when unauthenticated).
- **`consent-index.tsx`** (client) — "Forms to complete" list with status/required
  chips; the **live** grant-status cards (real, Withdraw via the existing revoke
  route); the existing `NominationCard` publication holds; and a **final overview**
  summarizing every form + grant before finishing.
- **`[formId]/page.tsx` + `form-editor.tsx`** (client) — the completion surface:
  - `<FormViewer>` (react-pdf) — read + page through the PDF; swappable component.
  - Checkboxes, one per parsed item; unchecked recorded as explicit `false`.
  - Typed fields with **autofill suggestion chips**: on focus of a field whose
    `fieldType` has a saved value, show a one-tap SUGGESTED fill (accept or edit,
    never silent). Modeled on browser autofill.
  - **Signature canvas** (mouse + touch), exports `toDataURL('image/png')`. Offers
    one-tap **reuse of the saved signature** (fetched bytes previewed, applied on
    tap) — still writes its own completion-bound record on submit.
  - Swappable **`VerificationStep`** with a default stub (`StubVerification`) that
    requires a deliberate action and yields `{ method, evidenceArtifactRef }`.
    Elevated forms block submit until it completes; a reused signature never
    satisfies it.
  - Draft autosave (debounced PUT) for leave/resume. Submit validates required
    items/fields client-side (server re-validates).

## Component 6 — Testing

- **Migration red/green** (`packages/db`, embedded-postgres): `CURIOLAB_MIGRATE_UPTO=0038`
  witnesses absence; 0039 → tables exist, append-only enforced on completion +
  signature (UPDATE/DELETE rejected), Mechanism-A grants correct, saved-field &
  draft upsert mutable.
- **Service** (`packages/app`, embedded-postgres):
  - required item unchecked → reject; required field missing → reject.
  - standard form → grant captured, method `click`, `evidence_artifact_ref == completionId`.
  - under-13 `public_publication` with a reused signature only (no verification) →
    reject; with verification (strong method + evidence) → grant captured.
  - saved-field upsert + read; draft save/resume; completion reconstruction.
  - PDF hash mismatch (tampered bytes) → reject.
- **HTTP** (`packages/http`): controller tests mirroring `guardian.test.ts`
  (auth scoping: another guardian / lapsed edge / 18+ child → opaque 403).
- **Catalog / PDF**: `- [ ]` parse test (clauses → items with stable keys); PDF-hash
  determinism test (regenerate → bytes/hash stable).

## Out of scope / deferred (explicit)

- Portal mounts for Forms 08–10 (mentor/director) and 11 (student, `selfGrant`) —
  catalogued + PDF-rendered here, UI mounted later.
- Flipping `consentGrantLedgerEnforced` on (legal review; unchanged here).
- Real (non-stub) Elevated identity verification — the hook is built and swappable;
  the provider integration is a follow-up.
- Reply-by-email / verified-domain concerns tracked elsewhere.

## Risks / notes

- **PDF determinism**: pdfkit embeds a creation date + file ID by default; both must
  be pinned or the committed-vs-regenerated hash drifts. Canonical source of truth is
  the committed bytes; the determinism test guards regeneration.
- **react-pdf bundle weight** on the parent portal — acceptable for reliable
  cross-device paging + touch signature; isolated behind `<FormViewer>` for swap.
- **Next 16 route conventions** differ from training priors — read the bundled docs
  before writing handlers (AGENTS.md).
- Curated overlay (required flags + grant mappings) is legal-sensitive data, not
  auto-derivable from `- [ ]` alone; keep it explicit and reviewable in the catalog.
