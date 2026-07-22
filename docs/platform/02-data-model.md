# 02. Data model

## Conventions

- Primary keys are `uuid`, generated in the database.
- Every table has `created_at timestamptz not null default now()`.
- Timestamps are `timestamptz`, stored in UTC.
- Money is never a source of truth here.
- Write discipline is marked per table: **mutable**, **append-only**, or **immutable-after-final**. Append-only tables have `UPDATE` and `DELETE` revoked at the role level and a trigger that raises on either.

The compliance-critical constraints (the DOB rule, the form-sourced consent rule, evidence-backed tier, single active membership, the guardian-invite binding, append-only enforcement) are database checks or triggers, not application code.

## Org structure

### chapter (mutable)
`id`, `name`, `slug` unique, `tier` enum(`seed`,`active`,`distinguished`), `status` enum(`prospective`,`active`,`paused`,`closed`), `timezone` (IANA).

### term (mutable)
`id`, `chapter_id` fk, `name`, `starts_on` date, `ends_on` date. Terms are per chapter. Index `(chapter_id, ends_on)`.

### pod (mutable)
`id`, `chapter_id` fk, `term_id` fk, `name`, `mentor_membership_id` fk null.

### pod_assignment (mutable)
`membership_id` fk, `pod_id` fk, `term_id` fk. Composite unique `(membership_id, pod_id, term_id)`. This table is the entire definition of instructor scope; a cluster is a later grouping over it and is not modeled now.

## Core identity

### account (mutable)
| column | type | notes |
|---|---|---|
| id | uuid | |
| email | citext null | unique when present; adults and 18-plus students |
| username | citext null | unique when present; minor students |
| legal_name | text | never rendered publicly |
| display_name | text | first name plus last initial for anyone under 18 |
| date_of_birth | date | the one canonical DOB |
| dob_provenance | enum(`enrollment_record`,`self_reported`,`staff_entered`) | |
| dob_source_ref | uuid fk null | the signed document, when provenance is `enrollment_record` |
| password_hash | text null | argon2id; null until activated |
| credential_owner | enum(`guardian_provisioned`,`self_private`) | see the 16+ transition in [06](06-onboarding-flows.md) |
| status | enum(`invited`,`pending`,`active`,`suspended`,`closed`) | |
| maturation_state | enum(`minor`,`maturation_pending`,`self_managed`) | drives the coming-of-age flow |
| created_by | uuid fk null | |

Constraints (database-enforced):
- Exactly one of `email` or `username`: `CHECK ((email IS NULL) <> (username IS NULL))`.
- Identity type matches age and role (trigger): a minor student is username-only, an adult is email.
- Decision-4 (trigger): any account with an active `student` membership must have `dob_provenance = 'enrollment_record'` and non-null `dob_source_ref`.

Indexes: unique partial on `email WHERE email IS NOT NULL` and on `username WHERE username IS NOT NULL`.

Age is derived from `date_of_birth` at request time, evaluated in the timezone of the student's enrolling chapter (the chapter of their student membership and enrollment record). See [07](07-test-plan.md) for the boundary test.

### session (mutable; rows deleted only by revocation)
| column | type | notes |
|---|---|---|
| id | uuid | plain identity, safe to log |
| token_hash | text unique | the secret; never logged |
| account_id | uuid fk | |
| mode | enum(`full`,`read_only`) | |
| impersonated_account_id | uuid fk null | |
| real_actor_account_id | uuid fk null | |
| expires_at | timestamptz | impersonation sessions expire in 30 minutes |
| revoked_at | timestamptz null | offboarding and suspension set this |

Trigger: an impersonation session (`impersonated_account_id` not null) targeting a minor must be `mode = 'read_only'`. Write paths also check `mode`.

### invite (mutable, single-use)
| column | type | notes |
|---|---|---|
| id | uuid | |
| token_hash | text | |
| kind | enum(`guardian`,`student`,`mentor`,`staff`) | |
| target_email | citext null | for a guardian invite, must equal the enrollment email |
| intended_account_id | uuid fk null | |
| enrollment_record_id | uuid fk null | |
| issued_by | uuid fk | |
| expires_at | timestamptz | 14 days |
| accepted_at | timestamptz null | |
| status | enum(`issued`,`accepted`,`expired`,`revoked`) | |
| delivery_status | enum(`sent`,`delivered`,`bounced`,`complained`) | fed by Resend webhook |

A guardian invite's `target_email` must equal the email on the bound enrollment record, enforced at creation; changing it requires a new signed form.

## The funnel

### application (mutable) and application_event (append-only)
| application | type | notes |
|---|---|---|
| id | uuid | |
| kind | enum(`student`,`university_role`) | |
| chapter_id | uuid fk | |
| status | enum(`submitted`,`screening`,`interview_scheduled`,`accepted`,`enrolled`,`declined`,`withdrawn`) | |
| applicant_name | text | |
| applicant_contact_email | citext | |
| guardian_name | text null | student applications |
| guardian_email | citext null | student applications; becomes the invite floor |
| guardian_signature_ref | uuid fk null | |
| track | text null | university-role applications |
| github_url | text null | university-role applications |
| reopened_from_id | uuid fk null | successor of a declined application |

Type-specific columns are constrained by a check keyed on `kind`. `application_event` records `(application_id, from_status, to_status, actor_id, note, at)`. Reopen mints a successor row in `submitted` with `reopened_from_id`; the declined row stays immutable.

### enrollment_record (mutable)
`id`, `application_id` fk, `student_account_id` fk null, `chapter_id` fk, `term_id` fk, `signed_form_ref` fk, `guardian_name_on_form` text, `created_by` fk.

No `date_of_birth` column. DOB lives once on `account`, with `dob_source_ref` pointing at the signed form. A student may have several enrollment records across terms.

## Standing and progression

### membership (mutable)
| column | type | notes |
|---|---|---|
| id | uuid | |
| account_id | uuid fk | |
| chapter_id | uuid fk | |
| role | enum (all roles) | one role per membership |
| status | enum(`pending`,`active`,`inactive`,`offboarded`,`suspended`) | |
| term_id | uuid fk null | |
| active_from | date null | override; null means use the term dates |
| active_until | date null | override; null means use the term dates |
| pod_id | uuid fk null | `student` and `junior_mentor` only |
| current_tier | enum(`explorer`,`builder`,`innovator`) null | `student` only |

Constraints: partial unique on `(account_id, chapter_id, role) WHERE status = 'active'`; `current_tier` non-null only for `student`; `pod_id` non-null only for `student` and `junior_mentor`. Indexes: `(account_id, status)`, `(chapter_id, term_end, status)` via the term join.

An in-force membership at decision time is `status = 'active'` AND `active_from <= now < active_until` (dates resolved from the term when the overrides are null, in the chapter timezone). Offboarding sets the student membership to `offboarded` keeping role, term, pod, and final tier, and inserts a new `alumni` membership with `term_id` null. Alumni membership has null `pod_id` and null `current_tier` (constraint).

### tier_transition (append-only)
`id`, `membership_id` fk, `from_tier` enum null, `to_tier` enum, `granted_by` fk, `evidence_ref` fk **not null**, `note` text null, `at` timestamptz. Writer must resolve to a `chapter_director` or `lead_instructor` at write time (trigger). An `AFTER INSERT` trigger sets `membership.current_tier = NEW.to_tier`.

## Relationships

### guardianship (mutable status, write-once verification facts)
`id`, `guardian_account_id` fk, `student_account_id` fk, `relationship` enum(`parent`,`guardian`,`other`), `status` enum(`pending`,`verified`,`rejected`,`revoked`,`lapsed`), `verification_method` enum(`signed_form_match`,`in_person_witnessed`,`sms_form_match`), `verified_by` fk null, `source_ref` fk null, `verified_at` timestamptz null.

Guardian access derives entirely from a `verified` row. `rejected` is a name mismatch (account closed, retained in audit). `revoked` is administrative or safeguarding. `lapsed` is the coming-of-age transition.

## Consent

### consent (append-only)
| column | type | notes |
|---|---|---|
| id | uuid | |
| seq | bigserial | total order for tiebreaking only |
| student_account_id | uuid fk | |
| type | enum(`enrollment`,`data_collection`,`platform_participation`,`public_profile`,`photo_media`,`external_publication`) | |
| action | enum(`grant`,`revoke`) | revocation is a new row |
| source | enum(`signed_form`,`digital`) | |
| source_ref | uuid fk null | the document, for form-sourced rows |
| enrollment_record_id | uuid fk null | non-null when `source = 'signed_form'`; the temporal anchor |
| scope_ref | uuid fk null | the specific project or issue, for `external_publication` |
| granted_by | uuid fk null | guardian, or the student if 18+; backfilled for form-sourced rows |
| effective_at | timestamptz | the guardian's decision instant; signature date for a form |
| reason | enum(`standard`,`safeguarding`) | safeguarding is a staff-initiated revoke |

Constraints: a `data_collection` row with `source = 'signed_form'` and null `source_ref` is invalid; a `signed_form` row with null `enrollment_record_id` is invalid; `external_publication` requires non-null `scope_ref`; `effective_at` may not be in the future and may not precede the **application submission date** (reached through `enrollment_record.application_id`), not the enrollment record's own creation. A signature date legitimately precedes the upload, so the enrollment record's `created_at` is the wrong floor; the application submission is the earliest meaningful anchor because a guardian cannot sign consent for a program not yet applied to. This is the ruled fix for the gap noted in [BUILD-STATUS.md](BUILD-STATUS.md).

Retention of consent rows follows the tiered schedule in [compliance-coppa.md](compliance-coppa.md) 1.5: consent evidence is kept seven years as audit defense.

Current state ordering: order by `effective_at DESC`, with `seq` as tiebreaker only for identical `effective_at`. `effective_at` is the guardian's decision, `seq` is filing order. See the two ordering tests in [07](07-test-plan.md).

### consent_current (maintained table, one row per student and type)
Maintained by a trigger on each `consent` insert, in the same transaction. This is a real table, not a view, because it is the stable lock target for the consent-touching couplings. Any operation that reads-then-acts on a consent state takes `SELECT ... FOR UPDATE` on the relevant row. See locking in [04](04-state-machines.md).

## Community content

### post (mutable body, lifecycle-controlled)
`id`, `chapter_id` fk, `pod_id` fk null, `author_membership_id` fk, `type` enum(`wip`,`finished_project`,`question`,`session_recap`,`milestone`), `body` text, `status` enum(`published`,`hidden`,`removed`), `system_generated` boolean. Authorship is by membership so it carries capacity and scope.

### comment (mutable body, lifecycle-controlled)
`id`, `post_id` fk, `author_membership_id` fk, `body`, `status` enum(`published`,`hidden`,`removed`). Same machine as post.

### reaction (mutable)
`target_type` enum(`post`,`comment`), `target_id`, `membership_id` fk, `kind`. Unique `(target_type, target_id, membership_id, kind)`.

### project (mutable, lifecycle-controlled)
`id`, `chapter_id` fk, `owner_membership_id` fk, `title`, `summary`, `status` enum(`draft`,`submitted`,`verified`,`public_listed`), `verified_by` fk null, `verified_at` timestamptz null. `public_listed` requires an active `external_publication` consent scoped to the project (trigger); revoking it moves the project back to `verified` (coupling C2).

### project_media (mutable) and media_depiction (mutable)
| project_media | type |
|---|---|
| id | uuid |
| project_id | fk null |
| post_id | fk null |
| storage_ref | uuid |
| review_status | enum(`ok`,`pending_review`,`removed`) |

| media_depiction | type | notes |
|---|---|---|
| media_id | fk | |
| account_id | fk | a real student reference |
| added_by | fk | |
| source | enum(`student`,`mentor`,`staff`) | |
| confirmed_at | timestamptz null | set by a mentor or staff to clear the image |

Composite PK `(media_id, account_id)`. Student uploads default `review_status = 'pending_review'`; students may attach images of their own work but cannot authoritatively tag people; only a `source in ('mentor','staff')` confirmation clears an image for uses gated by `photo_media`. Revoking `photo_media` flips every depicting media to `pending_review` (coupling C1).

### profile_narrative (mutable, lifecycle-controlled)
`id`, `account_id` fk, `body`, `status` enum(`draft`,`pending_review`,`published`,`removed`). A minor's edit sets `pending_review` and is not publicly reachable until `narrative.review` clears it. The student edits their own narrative, a guardian never authors or edits, staff may remove or clear but never author. Reportable via `moderation_report` with `target_type = profile_narrative`.

### timeline_entry (append-only)
`id`, `account_id` fk, `kind`, `occurred_at`, `ref`. The profile spine. Lifecycle transitions (enrollment, initial Explorer grant, first project, first mentor session) emit entries and system-generated milestone posts, which is how a new profile reads as complete rather than empty.

## Newsletter and money

### newsletter_issue (lifecycle-controlled)
`id`, `chapter_id` fk null (null for platform-wide), `title`, `body`, `status` enum(`draft`,`in_review`,`scheduled`,`published`,`archived`,`blocked`), `published_by` fk null, `published_at` timestamptz null. Only `published` is readable without a session. Archived issues are staff-read only.

### newsletter_subscriber (mutable, outside the account graph)
`id`, `email` citext, `unsubscribe_token_hash`, `subscribed_at`, `unsubscribed_at` null, `source`, `delivery_status` enum(`active`,`bounced`,`complained`). No foreign key to `account`. Unique `(email) WHERE unsubscribed_at IS NULL`.

### payment_ref (mutable) and scholarship (mutable)
| payment_ref | type |
|---|---|
| id | uuid |
| enrollment_record_id | fk |
| stripe_customer_ref | text |
| status | enum(`none`,`active`,`past_due`,`waived`) |
| tier_paid_for | text |

| scholarship | type |
|---|---|
| id | uuid |
| enrollment_record_id | fk |
| awarded_by | fk |
| percentage | integer |
| note | text |

No amounts as source of truth, no card data, no reconciliation.

## Moderation, verification, deletion

### moderation_report (mutable, write-once filing fields)
| column | type | notes |
|---|---|---|
| id | uuid | |
| target_type | enum(`post`,`comment`,`project_media`,`profile_narrative`) | |
| target_id | uuid | |
| reporter_account_id | uuid fk | actors are accounts, to accommodate platform actors with no membership |
| chapter_id | uuid fk | |
| class | enum(`safety`,`ordinary`) | drives the SLA |
| reason | enum(`harmful`,`sexual`,`threatening`,`self_harm_disclosure`,`off_topic`,`unkind`,`spam`,`quality`) | |
| filed_at | timestamptz | |
| due_at | timestamptz GENERATED ALWAYS AS (filed_at + CASE WHEN class='safety' THEN interval '24 hours' ELSE interval '72 hours' END) STORED | |
| acknowledged_at | timestamptz null | |
| resolved_at | timestamptz null | |
| resolver_account_id | uuid fk null | |
| resolver_membership_id | uuid fk null | shows capacity when the resolver has a membership |
| action_taken | enum(`none`,`hidden`,`removed`,`dismissed`,`escalated`) null | |
| escalated_at | timestamptz null | |
| escalated_to | uuid fk null | |
| note | text null | |

Partial index `(due_at) WHERE resolved_at IS NULL`. SLA met is `resolved_at <= due_at`, queryable.

### verification_token (append-only in practice)
`id`, `subject_account_id` fk, `token_hash` text unique, `issued_by` fk, `issued_at`, `revoked_at` null. Partial unique on `(subject_account_id) WHERE revoked_at IS NULL`. Regeneration is one insert plus one revoke. When `public_profile` is inactive, the endpoint returns a neutral not-shared response, never a 404.

### deletion_request (mutable, append-only decision)
`id`, `subject_account_id` fk, `requested_by` fk, `scope_requested` enum(`full`,`redaction`), `status` enum(`requested`,`under_review`,`fulfilled_full`,`fulfilled_redaction`,`partially_fulfilled`,`refused`), `reviewed_by` fk null, `decision_reason` text null, `decided_at` timestamptz null. A refusal must carry a documented reason. The verification minimum (tier, project titles, dates, hours) is separable from erasable personal content (contact, narrative, media, timeline, identifiers); redaction preserves an anonymized skeleton, full erase removes it. Audit `detail` for a deletion holds references, never the erased PII.

## Audit

### audit_entry (append-only, partitioned by month)
`id`, `at` timestamptz (partition key), `actor_account_id` fk null, `real_actor_account_id` fk null, `action` text, `subject_type` text, `subject_id` uuid null, `chapter_id` fk null, `detail` jsonb. `UPDATE` and `DELETE` revoked at the role level plus a trigger backstop. Indexes `(subject_type, subject_id, at)` and `(actor_account_id, at)`. Every "must not" event writes here, including `permission.denied`, so the log doubles as an intrusion signal. An audit query logs one `audit.read` entry per query, not per row, which bounds any regress.
