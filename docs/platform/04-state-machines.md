# 04. State machines

Each machine lists states, transitions with the triggering capability and actor, and side effects. Transactional couplings are consolidated at the end because several span two machines, which is where bugs hide.

## Account

States: `invited`, `pending`, `active`, `suspended`, `closed`. Governs authentication, distinct from membership standing. An account can be `active` with no active membership (a guardian, or an alumnus between roles).

| from -> to | capability | actor | side effects |
|---|---|---|---|
| (none) -> invited | `member.invite` | director, comms, admin | invite row plus email on the transactional subdomain |
| invited -> pending | accept invite (token) | invitee, or guardian for a student | credentials set; for a student the guardianship edge must be `verified` |
| pending -> active | `member.activate` | chapter_director | atomic with membership activation (coupling A) |
| active -> suspended | `account.suspend` | director, admin | all sessions revoked |
| suspended -> active | `account.reinstate` | director, admin | |
| any -> closed | `account.close` | admin | sessions revoked; records retained seven years, never deleted |

## Membership

States: `pending`, `active`, `inactive`, `offboarded`, `suspended`.

| from -> to | capability | actor | side effects |
|---|---|---|---|
| (none) -> pending | `member.invite` / enroll | chapter_director | student requires an enrollment record |
| pending -> active | `member.activate` | chapter_director | requires active `enrollment` consent for a student; couplings A and F |
| active -> inactive | window elapsed | system | bookkeeping only; access already ended at `active_until` by decision-time evaluation |
| active / inactive -> offboarded | `membership.offboard` | director, admin | the offboard bundle (coupling B) |
| active -> suspended | `membership.suspend` | director, admin | pod access removed |
| suspended -> active | `membership.reinstate` | director, admin | |

## Consent

No mutable state. An append-only sequence of `grant` and `revoke` rows. Current state is the highest `effective_at` per type, `seq` as tiebreaker.

| event | capability | actor | side effects |
|---|---|---|---|
| form-sourced grant | enrollment upload | chapter_director | `enrollment` and `data_collection` rows created atomically with the signed-form upload (coupling D); `granted_by` backfilled at verification |
| digital grant | `consent.grant` | guardian, or student 18+ | none beyond the row |
| revoke `photo_media` | `consent.revoke` | guardian, or student 18+ | depicting media flip to `pending_review` (coupling C1) |
| revoke `external_publication` | `consent.revoke` | guardian, or student 18+ | scoped project or issue de-published (coupling C2) |
| revoke `platform_participation` | `consent.revoke` | guardian, or student 18+ | no data change; writes and feed reads start denying at step 5 |
| safeguarding suspend | `consent.revoke_safeguarding` | chapter_director, admin | inserts `reason = safeguarding` revokes for `public_profile` and `photo_media`; stand until a new guardian decides |

## Guardianship

States: `pending`, `verified`, `rejected`, `revoked`, `lapsed`.

| from -> to | capability | actor | side effects |
|---|---|---|---|
| (none) -> pending | guardian invite issued | chapter_director | bound to the form email |
| pending -> verified | `guardianship.verify` | chapter_director | name-on-account matched to name-on-form; backfills `granted_by` on form-sourced consents |
| pending -> rejected | `guardianship.verify` (mismatch) | chapter_director | account closed; attempt retained in audit |
| verified -> revoked | `guardianship.revoke` | director, admin | guardian access ends immediately; consents granted before revocation stand; a new guardian must be verified before further consent decisions |
| verified -> lapsed | `maturation.confirm` or the 90-day backstop | chapter_director or system | guardian read access ends |

## Newsletter issue

States: `draft`, `in_review`, `scheduled`, `published`, `archived`, `blocked`.

| from -> to | capability | actor | side effects |
|---|---|---|---|
| (none) -> draft | `newsletter.draft` | instructor, comms, director | |
| draft -> in_review | `newsletter.submit_review` | drafter | |
| in_review -> draft | `newsletter.return` | director | |
| in_review -> scheduled | `newsletter.schedule` | chapter_director | records a send time |
| scheduled -> published | `newsletter.publish` | chapter_director, or system at the scheduled time | subject consent re-checked at this instant (coupling E); send enqueued after commit |
| scheduled -> blocked | consent re-check fails | system | director notified with the specific student whose consent stopped it |
| blocked -> in_review / scheduled | `newsletter.return` / `newsletter.schedule` | director | retry after consent obtained |
| published -> archived | `newsletter.unpublish` | director, admin | unreadable except by staff; consent-driven unpublish also redacts the affected item (extends coupling C2); never deleted |

## Feed post and comment

States: `published`, `hidden`, `removed`.

| from -> to | capability | actor | side effects |
|---|---|---|---|
| (none) -> published | `feed.post` / `feed.comment` | posting role, minor gated on `platform_participation` | milestone posts are `system_generated` and skip the consent gate |
| published -> hidden | `feed.moderate` or `feed.hide_safety` | moderator, or any chapter instructor for safety | reversible; safety hide auto-files a `class = safety` report |
| hidden -> published | `feed.moderate` | moderator | |
| published / hidden -> removed | `feed.moderate` | chapter_director | body blanked, row and audit retained; terminal |

## Project

States: `draft`, `submitted`, `verified`, `public_listed`.

| from -> to | capability | actor | side effects |
|---|---|---|---|
| (none) -> draft | `project.create` | student (own), instructor | |
| draft -> submitted | `project.submit` | student (own) | |
| submitted -> verified | `project.verify` | instructor (own pod), director | becomes a tier_transition `evidence_ref` |
| verified -> public_listed | `project.publish_public` | chapter_director | requires scoped `external_publication`, atomic |
| public_listed -> verified | `consent.revoke` (system) or `project.unpublish` | system or director | de-listed; coupling C2 |

## Application

States: `submitted`, `screening`, `interview_scheduled`, `accepted`, `enrolled`, `declined`, `withdrawn`.

Transitions by relations_manager or chapter_director, except `submitted` (public applicant) and `withdrawn` (applicant or staff). `enrolled` creates the enrollment record (coupling D). Reopen mints a successor `submitted` row with `reopened_from_id`; the declined row stays immutable. Every transition writes an `application_event`.

## Invite

States: `issued`, `accepted`, `expired`, `revoked`. `delivery_status` is orthogonal.

`issued -> accepted` (invitee via single-use token; moves the account `invited -> pending`). `issued -> expired` at decision time past `expires_at`. `issued -> revoked` on resend (new token minted, old hash discarded, expiry reset). A `bounced` or `complained` delivery status surfaces a visible stall in the Chapter Director queue.

## Moderation report

States: `filed`, `acknowledged`, `resolved`; `escalated` reachable from any pre-resolution state.

`filed` notifies the Chapter Director immediately for `safety` (any instructor may hide on sight) or the responsible instructor and director for `ordinary`. `acknowledged` sets `acknowledged_at`. `resolved` sets `action_taken` and `resolved_at`. A timer job escalates any `resolved_at IS NULL AND due_at < now() AND escalated_at IS NULL`, notifying the escalation target; an unresponsive Chapter Director on a safety report escalates to `platform_admin`.

## Account maturation (coming of age)

States: `minor`, `maturation_pending`, `self_managed`.

Automatic at the 18th birthday (decision time): the student's own consent authority activates, the guardian's consent write authority ends (guardian path requires `childAge < 18`), and `platform_participation` stops being required for the student's own actions.

| from -> to | capability | actor | side effects |
|---|---|---|---|
| minor -> maturation_pending | student adds and verifies an email | the student | guardian read still active |
| maturation_pending -> self_managed | `maturation.confirm` | chapter_director | guardianship edge `verified -> lapsed`; account converts to email-capable |

Backstop: if maturation is not completed within 90 days of the 18th birthday, the edge lapses automatically (`verified -> lapsed`), with a notice to both parties 30 days prior. A locked-out adult former student recovers via `account.recover` (see [06](06-onboarding-flows.md)).

## Deletion request

States: `requested`, `under_review`, `fulfilled_full`, `fulfilled_redaction`, `partially_fulfilled`, `refused`. `requested` by guardian or self 18+. Fulfillment (erase or redaction) runs atomically per record and is audited by reference, never copying the erased PII into the log. Any refusal or partial fulfillment carries a documented reason.

## Transactional couplings

Each must be one transaction. Consent-touching couplings run under READ COMMITTED with explicit `SELECT ... FOR UPDATE` on the relevant `consent_current` row as the serialization point, not SERIALIZABLE (see [decision-log.md](decision-log.md)).

- **A. Account activation with membership activation.** Both `pending -> active` together.
- **B. The offboard bundle.** Membership `-> offboarded`, sessions for that scope revoked, pod assignment removed, and for a student the new `alumni` membership created, all atomic.
- **C1. `photo_media` revoke with media re-review.** The revoke row and the flip of every depicting media to `pending_review` commit together. The revoke locks the `consent_current` row; media inserts that depict a student also lock it before reading, so a concurrent insert cannot slip between the revoke's read and its effect.
- **C2. `external_publication` revoke with de-publication.** The revoke row and the project `public_listed -> verified` (or issue unpublish and item redaction) commit together.
- **D. Enrollment upload with the two form-sourced consents.** The signed-form document, the enrollment record, and the `enrollment` and `data_collection` consent rows are created in one transaction, so an operational record never exists before its consent row.
- **E. Newsletter publish with the subject consent re-check.** The consent verification (under a `FOR UPDATE` lock on each item's `consent_current` row) and the status change are one transaction; the send is enqueued only after commit. A concurrent revoke blocks on the same row, so a send never goes out for revoked work.
- **F. Tier transition with the current_tier update.** The `tier_transition` insert and the `membership.current_tier` write are one transaction, enforced by the trigger.
- **G. Minor-record read with its audit obligation.** The read and the `minor_record.read` write share a transaction, so a read that cannot be logged does not occur.

The recurring pattern: consent revocation is never a status change alone, it always carries the content consequence in the same transaction, and membership expiry is enforced at decision time rather than by the sweeper.
