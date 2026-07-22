# 05. API surface

REST route handlers under Next.js, each calling `authorize(ctx, capability, resource)` before touching data. Grouped by surface. The **M** column flags any endpoint that reads or writes a minor's data, which is the set carrying read-logging obligations, the strictest consent gates, and the closest review. Mutating endpoints run inside the transaction couplings from [04](04-state-machines.md) where one applies.

## The single-code-path invariant, stated honestly

Every mutating route that has an actor resolves through one `authorize` call over the registry, with no bespoke permission logic. A small enumerated set of actor-less write endpoints have no `AuthContext` and cannot call `can`, so each carries its own documented protection and is inert (creates only a row with no authority that cannot be escalated without a staff action). That set is the entire attack surface a stranger can reach:

| endpoint | protection | inert because |
|---|---|---|
| POST /public/apply | rate limit, bot check, dedupe | creates an `application` in `submitted`, no account, no edge |
| GET /invites/:token | timing-safe, identical response for invalid/expired/accepted | read-only, reveals nothing and no child name |
| POST /invites/:token/accept | rate limit, single-use token | creates a `pending` account and `pending` edge, zero authority until verify |
| POST /invites/:token/accept-student | same | creates a `pending` student account, no active membership until activate |
| POST /webhooks/resend | signature verification, idempotent | mutates only delivery status |
| POST /webhooks/stripe | signature verification, idempotent | mutates only payment status |
| POST /public/newsletter/subscribe | rate limit, double opt-in | writes only to the subscriber list |
| GET /public/newsletter/unsubscribe/:token | token-gated | flips one subscriber row |
| POST /auth/password/reset-request, /reset | rate limit, uniform response, token-gated | issues or consumes a reset token, no enumeration signal |

## Auth

| method + path | capability | M | notes |
|---|---|---|---|
| POST /auth/login | none | | username-or-email plus password; opaque session cookie |
| POST /auth/logout | none | | deletes the session row |
| GET /auth/session | none | | returns the AuthContext summary and the membership switcher |
| POST /auth/password/reset-request | none | M | adult emails a token; minor routes to all verified guardians (or the director for a `self_private` account); response identical whether or not the account exists |
| POST /auth/password/reset | none | M | token-gated |
| POST /auth/email/add | none (self session) | M | the maturation email add for an 18+ student |
| POST /auth/impersonate | impersonation.start | M | platform_admin only; read-only if the target is a minor; 30-minute expiry |
| DELETE /auth/impersonate | none | | ends the impersonation session |

## Public site (no account)

| method + path | capability | M | notes |
|---|---|---|---|
| GET /public/newsletter, /:slug | public_site.read | | only `published` issues |
| GET /public/projects, /:id | public_site.read | | only `public_listed` |
| GET /verify/:token | public_site.read | M | neutral not-shared when `public_profile` inactive; `noindex`; never distinguishes not-shared from not-existent |
| POST /public/apply | none | M | unauthenticated; abuse handling below; inert row |
| POST /public/newsletter/subscribe | none | | double opt-in |
| GET /public/newsletter/unsubscribe/:token | none | | outside the account graph |

Abuse handling on POST /public/apply: rate limit per IP and per email, a bot check at the edge (Cloudflare Turnstile or equivalent), duplicate suppression on `(guardian_email, applicant_name)`. The write creates only an `application` in `submitted`, never an account or edge.

## The Lab (internal feed, active membership required)

| method + path | capability | M | notes |
|---|---|---|---|
| GET /lab/feed | feed.view | M | minor gated on `platform_participation`; outside-pod reads log |
| POST /lab/posts | feed.post | M | minor gated on `platform_participation` |
| PATCH /lab/posts/:id | feed.post (own) | M | edit own only |
| POST /lab/posts/:id/comments | feed.comment | M | |
| POST /lab/{posts,comments}/:id/reactions | feed.react | M | |
| POST /lab/reports | feed.report | M | files a `moderation_report`; class drives the SLA |
| POST /lab/posts/:id/hide | feed.moderate or feed.hide_safety | M | safety hide usable by any chapter instructor, not pod-bound |
| POST /lab/posts/:id/remove | feed.moderate | M | body blanked, row retained |
| GET /lab/moderation/queue | feed.moderate | M | ordered by `due_at` where unresolved |
| POST /lab/moderation/:id/{ack,resolve,escalate} | feed.moderate / moderation.resolve | M | resolve requires age >= 18 |

## Student profile and projects

| method + path | capability | M | notes |
|---|---|---|---|
| GET /profile/:id | student.view_record or profile.view | M | verified plus narrative; zero-state sections; outside-pod reads log |
| PATCH /profile/narrative | profile.edit_narrative (own) | M | student authors own only; a minor's edit sets `pending_review` |
| POST /profile/narrative/:id/review | narrative.review | M | clears a minor's narrative to `published` |
| POST /profile/verification-token | verification.regenerate | M | revokes the old token |
| POST /projects | project.create | M | |
| PATCH /projects/:id/submit | project.submit (own) | M | |
| POST /projects/:id/verify | project.verify | M | instructor own pod or director |
| POST /projects/:id/publish | project.publish_public | M | director, requires scoped `external_publication`, atomic |

## Guardian portal (guardian scope, minor data by definition)

| method + path | capability | M | notes |
|---|---|---|---|
| GET /guardian/children/:id/record | guardian.view_child_record | M | own child, logs the read |
| GET /guardian/children/:id/fees | guardian.view_fee_status | M | links out to Stripe |
| POST /guardian/children/:id/consents | consent.grant | M | guardian, or self if 18+ |
| POST /guardian/children/:id/consents/:type/revoke | consent.revoke | M | not DELETE; inserts a revoke row; fires C1 or C2 |
| POST /guardian/children/:id/invite-student | (guardian scope) | M | begins student onboarding |
| POST /guardian/children/:id/export | guardian.request_export | M | files a request |
| POST /guardian/children/:id/deletion | guardian.request_deletion | M | files a `deletion_request` |
| GET /guardian/digest | guardian.view_digest | | the chapter digest, never the feed |

## Operations back office (chapter staff)

| method + path | capability | M | notes |
|---|---|---|---|
| GET /ops/applications, PATCH /ops/applications/:id | application.view / application.transition | M | includes reopen |
| POST /ops/enrollments | enrollment.create | M | record, signed form, two form-sourced consents, coupling D |
| POST /ops/invites, /:id/resend, DELETE /:id | member.invite | M | resend invalidates the old token |
| POST /ops/guardianships/:id/verify | guardianship.verify | M | the name-match authority floor |
| POST /ops/guardianships/:id/revoke | guardianship.revoke | M | administrative or safeguarding |
| POST /ops/students/:id/consents/safeguard-suspend | consent.revoke_safeguarding | M | the narrow staff exception |
| POST /ops/memberships/:id/{activate,offboard,suspend} | member.activate / membership.offboard / membership.suspend | M | activate is couplings A and F; offboard is B |
| POST /ops/memberships/:id/tier | tier.grant | M | requires a non-null `evidence_ref`, coupling F |
| POST /ops/maturations/:id/confirm | maturation.confirm | M | the age-18 staff confirmation |
| POST /ops/accounts/:id/reissue-setup | account.recover | M | adult former students only; rejected against an active membership; documented identity check |
| POST /ops/students/:id/self-private | (self session, witnessed) | M | 16+ credential privatization, requires a non-guardian chapter witness |
| GET /ops/deletion-requests, POST /:id/{fulfill,refuse} | deletion.review / deletion.fulfill | M | tiered erase or redaction; documented refusal |
| GET /ops/media/review-queue, POST /ops/media/:id/{confirm-depiction,clear,remove} | media.review | M | the photo confirmation policy |
| POST /ops/newsletter, PATCH, /:id/{submit,schedule,publish,unpublish} | newsletter.draft / .publish etc. | | publish is coupling E |
| GET /ops/audit | audit.view | M | chapter-scoped for a director; each read logs one entry |

## Platform administration

| method + path | capability | M | notes |
|---|---|---|---|
| CRUD /admin/chapters, /admin/terms, /admin/pods | chapter.manage etc. | | org structure |
| GET /admin/audit | audit.view (global) | M | cross-chapter |
| POST /admin/newsletter/publish | newsletter.publish | | platform-wide issues only, zero student-authored items |
| cross-chapter reads | platform_staff read scope | M | read-only across chapters |

## Webhooks

`POST /webhooks/resend` and `POST /webhooks/stripe` do not go through `authorize` because there is no actor. Both verify the provider signature over the raw request body, are idempotent on the provider event id, and mutate only the narrow delivery-and-payment status fields. A forged call that somehow passed signature check still could not touch identity, consent, or standing.
