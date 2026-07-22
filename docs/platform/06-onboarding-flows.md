# 06. Onboarding flows

Numbered steps rather than diagrams, because ordering and the transactional couplings matter more than the picture. Each step names the endpoint, the capability, and the state transition.

Shared parameters: **token expiry is 14 days** on every invite, evaluated at decision time. **Resend** (`POST /ops/invites/:id/resend`, `member.invite`) mints a new token, discards the old hash, and resets the clock; the old link returns the same opaque invalid response as a forged one.

## Flow A: Guardian onboarding

1. An application is submitted publicly and moves through screening to `accepted`.
2. On `accepted -> enrolled`, the Chapter Director calls `POST /ops/enrollments` (`enrollment.create`). Coupling D: the signed-form document, the enrollment record, and the `enrollment` and `data_collection` consent rows commit in one transaction, the consents with `granted_by` null and `effective_at` set to the date on the form.
3. The Director issues the guardian invite, `POST /ops/invites` (`member.invite`), bound to the exact email on the signed application.
4. The guardian opens `GET /invites/:token`, which validates timing-safely and returns only the kind and chapter. No child name.
5. The guardian calls `POST /invites/:token/accept`, setting a password against the known email. The account moves `invited -> pending`; a guardianship edge is created `pending`. No authority yet.
6. The Director calls `POST /ops/guardianships/:id/verify` (`guardianship.verify`), matching the accepting account's name to the name on the form. On match the edge moves `pending -> verified` and the form-sourced consents are backfilled with `granted_by`. On mismatch it moves `pending -> rejected`, the account is closed, and the Director re-issues (a new signed form if the bound email itself was wrong).
7. The verified guardian grants the digital consents they choose (`POST /guardian/children/:id/consents`): `platform_participation`, `public_profile`, `photo_media`, and any item-scoped `external_publication`, each defaulting to not granted.
8. The guardian triggers the student invite, beginning Flow B.

## Flow B: Student onboarding

The child has no email, so the invite is guardian-mediated end to end.

1. The verified guardian calls `POST /guardian/children/:id/invite-student`. The token is delivered to the guardian's contact email, and setup is done by the guardian with the child present.
2. The setup page opens `GET /invites/:token`, then `POST /invites/:token/accept-student`, which sets a username and password rather than an email. The account moves `invited -> pending` with a username identity; no email is collected.
3. The Chapter Director calls `POST /ops/memberships/:id/activate` (`member.activate`). Couplings A and F together: the membership `pending -> active`, the account `pending -> active`, and the initial Explorer `tier_transition` written, in one transaction. Activation requires active `enrollment` consent.
4. The student signs in with username and password. Posting, commenting, and feed reading are gated on `platform_participation`.

Wrong-person acceptance is contained by shape: every acceptance produces only a `pending` account and, for a guardian, a `pending` edge, and authority attaches solely at name-match verification or staff activation. A stranger who accepts holds an inert shell; detection leads to close, reject, reissue, and an audit entry.

## Flow C: Mentor onboarding

1. A university-role application (track and GitHub link) reaches `accepted`.
2. The Director or Relations Manager issues the mentor invite to the mentor's own email.
3. The mentor opens `GET /invites/:token` and calls `POST /invites/:token/accept`, setting email and password. Account `invited -> pending`.
4. The Director calls `POST /ops/memberships/:id/activate` with the teaching role and pod assignment. No guardian and no consent apply.
5. Edge case: an Innovator who graduates into a `junior_mentor` role may still be a minor. A minor mentor keeps their student-style account and guardian consents and gains the mentor membership on top, so consent still gates their writes. Flagged for legal ([open-questions.md](open-questions.md)) as a minor in a paid, company-like role.

## Flow D: Coming of age, with the backstop

1. On the 18th birthday (decision time, enrolling-chapter timezone): the student's own consent authority turns on and the guardian's consent write authority turns off, automatically, no endpoint.
2. The student may initiate maturation by adding and verifying an email (`POST /auth/email/add`), moving `minor -> maturation_pending`. Guardian read persists through this state.
3. The Chapter Director confirms (`POST /ops/maturations/:id/confirm`), moving `maturation_pending -> self_managed`, lapsing the guardianship edge, and converting to email-capable.
4. Backstop: if maturation is not completed within 90 days of the birthday, the edge lapses automatically, ending guardian read, with a notice to both parties 30 days prior. A locked-out adult former student (username-only, forgotten password, no verified guardian) recovers via `POST /ops/accounts/:id/reissue-setup` (`account.recover`, Chapter Director), which after a documented identity check mints a fresh setup token so they add an email and set a new password. The recovery is rejected against any account with an active membership.

## Flow E: Staff onboarding, and seeding

1. A Chapter Director issues a staff invite (`POST /ops/invites`, `member.invite`) to a staff email.
2. The invitee accepts (`POST /invites/:token/accept`, email and password); the account moves `invited -> pending`.
3. The Director activates the membership with the staff role. For a new Seed chapter with no Director yet, the issuer is `platform_admin`.
4. Seeding the first `platform_admin`: a deliberately awkward, audited, self-disabling maintenance script run against the database with direct credentials, never an HTTP endpoint. It refuses to run if any `platform_admin` already exists, so it works exactly once, and it writes an `account.seed` audit entry.

## The `self_private` credential transition (16+)

From age 16 a student may privatize their credential (`credential_owner: guardian_provisioned -> self_private`) from an authenticated session. Because a guardian holding the child's credentials is indistinguishable from the child cryptographically, the transition requires a chapter adult who is not a guardian to witness it, recorded as `witnessed_by`. The student sets a new password with a mentor or instructor present. Afterward, password reset for that account routes to the Chapter Director rather than to guardians. A student under 16 cannot transition, and a transition witnessed by a guardian of that student is rejected.

## Paper-period import mapping (fall 2026)

The fall 2026 cohort runs on paper (see [08-build-phasing.md](08-build-phasing.md)). Everything collected on paper must map cleanly onto the schema so a later import is transcription, not archaeology. The field-level and folder discipline is in [paper-period.md](paper-period.md); the mapping is:

| paper artifact | imports to | notes |
|---|---|---|
| application form | `application` (kind `student` or `university_role`) | one row per applicant; status transcribed from the tracking sheet |
| interview and decision notes | `application_event` rows | preserves the decision history and any reopen |
| signed enrollment and consent form | `enrollment_record` plus `signed_form_ref` in object storage | the scanned form is the `dob_source_ref` and the guardianship `source_ref` |
| date of birth on the form | `account.date_of_birth` with `dob_provenance = enrollment_record` | never re-keyed from any other sheet |
| the consent checkboxes and signature | form-sourced `consent` rows (`enrollment`, `data_collection`), `source = signed_form`, `effective_at` = signature date | additional digital consents are collected in-platform after import |
| guardian name and email on the form | `guardianship` (created `pending`) and the guardian invite floor | the email drives the later invite; a different email needs a new form |
| roster spreadsheet | `membership` rows with tier and pod | tier transcribed with the paper evidence reference |

The import is a one-time, audited job run by the founder, not a contributor task, and it writes an audit entry per record created.
