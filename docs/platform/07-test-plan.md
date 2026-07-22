# 07. Test plan

Authorization is the priority. The pure core exists so the entire authorization matrix runs as fast in-memory tests with no server and no database, which is where the bulk of the value and the bulk of the tests are.

## Test layers, in priority order

1. **Core authorization unit tests.** `can(ctx, capability, resource)` against hand-built fixtures. Thousands of cases, milliseconds, no IO. The matrix and the must-not register live here.
2. **Database guarantee tests.** Real Postgres. Checks, triggers, append-only enforcement, RLS filtering, generated columns. The floor is tested directly, not through the app.
3. **Integration tests.** Endpoints, including all nine unauthenticated write routes and both webhooks, verifying that the wrapper logs denials, that obligations run transactionally, and that client responses are opaque.
4. **Flow tests.** Onboarding A, B, C, E end to end, wrong-person acceptance, and the coming-of-age flow with its backstop and recovery.

## Fixtures

**Actors** (each a fully-formed `AuthContext`): `platform_admin`, `platform_staff`, `chapter_director@C1`, `lead_instructor@C1/pod1`, `senior_instructor@C1/{pod1,pod2}`, `junior_mentor_adult@C1/pod1`, `junior_mentor_minor@C1/pod1`, `comms_associate@C1`, `student_minor_consented@C1/pod1`, `student_minor_no_participation@C1/pod1`, `student_16_self_private`, `student_18@C1`, `alumni@C1`, `alumni_with_active_mentor@C1/pod1`, `guardian_of_S@C1`, `guardian_of_S_lapsed`, `no_membership`, `anonymous`.

**Resources**: post in pod1, pod2, C2; newsletter issue with no student items, a consented student item, an unconsented student item, and the consent-snapshot field absent; project owned-by-self, other-in-pod, other-chapter; child record for own-child, in-pod, out-of-pod, out-of-chapter; a `class=safety` and a `class=ordinary` report.

The matrix is the cartesian product of actors, capabilities, and resource scopes, each with an asserted decision, generated parametrically. Two capabilities are worked in full because the brief named them.

### Worked sweep: feed.comment

| actor | resource | expected | reason if denied |
|---|---|---|---|
| student_minor_consented | post in own pod | allow | |
| student_minor_no_participation | post in own pod | deny | actor_consent_missing |
| student_18 | post in own chapter | allow | |
| alumni | any post | deny | role_not_permitted |
| alumni_with_active_mentor | post in that pod | allow | acts under the mentor membership |
| guardian_of_S | any post | deny | out_of_scope |
| junior_mentor_minor | post in own pod | allow | |
| no_membership / anonymous | any | deny | out_of_scope / unauthenticated |
| student_minor_consented | post in C2 | deny | out_of_scope |

### Worked sweep: newsletter.publish

| actor | resource | expected | reason if denied |
|---|---|---|---|
| chapter_director@C1 | issue in C1, no student items | allow | |
| chapter_director@C1 | issue in C1, consented student item | allow | |
| chapter_director@C1 | issue in C1, unconsented student item | deny | subject_consent_missing |
| chapter_director@C1 | issue in C1, snapshot absent | deny | subject_consent_unknown |
| comms_associate@C1 | any issue | deny | role_not_permitted |
| lead_instructor@C1 | any issue | deny | role_not_permitted |
| platform_admin | issue with unconsented student item | deny | consent gate runs even for platform |
| platform_staff | issue with any student item | deny | platformGrant restricts staff to zero-student issues |
| platform_staff | platform issue, no student items | allow | |
| chapter_director@C2 | issue in C1 | deny | out_of_scope |

## The must-not register

Each row must fail before its guard is implemented, mapped to a test and a layer.

| # | must not | test | layer |
|---|---|---|---|
| 1 | permission derived from a single account field | two memberships on one account resolve independently by resource | core |
| 2 | no self-registration | no route creates an account without a valid invite token | integration |
| 3 | student DOB self-reported | student membership whose account has `dob_provenance != enrollment_record` is rejected | db |
| 4 | consent updated in place | UPDATE or DELETE on `consent` raises | db |
| 5 | external_publication blanket or mismatched | publish with a consent scoped to a different item denies | core |
| 6 | guardian reads the feed | `can(guardian, feed.view)` denies; guardian in no chapter role | core |
| 6b | parental account access invisible | student password reset raises a student notice and a profile sign-in entry | integration |
| 7 | non-authorized publish | comms, instructor deny `newsletter.publish` | core |
| 7b | student content published without naming consent | publish denies without a scoped `external_publication` | core |
| 8 | audit mutated | UPDATE/DELETE on `audit_entry` raises; a denied `can` writes `permission.denied` | db + integration |
| 9 | deactivation deletes | offboard retains the membership, posts, and audit trail | integration |
| 10 | consent overridden by role | platform_admin publish without subject consent denies at step 6 | core |
| 11 | write-impersonation of a minor | impersonation targeting a minor cannot be `full` (db); a write under it denies (core) | db + core |
| 12 | alumni participates | alumni denies `feed.comment` unless an active mentor membership | core |
| 13 | minor resolves a safety report | `can(junior_mentor_minor, moderation.resolve, safety_report)` denies | core |
| 14 | minor reads feed without participation | `can(student_minor_no_participation, feed.view)` denies | core |
| 15 | invite leaks a child | `GET /invites/:token` contains no name for a valid guardian token | integration |
| 16 | unauthenticated write confers authority | apply and both accept routes create only inert rows | integration |
| 17 | guardian invite to a non-form email | a guardian invite whose `target_email` differs from the enrollment email is rejected | db + integration |
| 18 | guardian grants consent for an 18-year-old | `can(guardian, consent.grant, child_18)` denies; `student_18` self-grants allows | core |
| 19 | guardian read persists past the lapse | `can(guardian_of_S_lapsed, guardian.view_child_record)` denies | core |
| 20 | stale-active membership after term end | a membership past `active_until` with `status` still active denies at decision time | core |
| 21 | deny reason leaks to client | out_of_scope, role_not_permitted, subject_consent_missing map to one identical opaque Forbidden | integration |
| 22 | subject consent unknown treated as absent | a resource missing the snapshot denies `subject_consent_unknown` | core |
| 23 | minor password reset as username oracle | reset response byte-identical for existing and non-existing username | integration |
| 24 | verification URL leaks existence | with `public_profile` inactive, `GET /verify/:token` returns the neutral body, not 404 | integration |
| 25 | read of a minor's record without a log | if the `minor_record.read` write fails, the read transaction rolls back | integration |
| 26 | minor narrative public without review | a minor's narrative edit sets `pending_review`, not publicly reachable until cleared | core + integration |
| 27 | suspended account acts | a suspended account denies every capability with `account_not_active` | core |
| 28 | closed account acts | a closed account the same | core |
| 29 | expired session acts | an expired session denies `session_invalid` at decision time | core |
| 30 | revoked session acts | a revoked session denies immediately after offboarding (coupling B) | core + integration |

## Consent ordering tests

Both must pass:
1. Form dated 1 Sep, uploaded 20 Oct, revocation dated 5 Oct, assert **inactive**.
2. Revocation dated 5 Oct, new form signed 12 Oct uploaded 20 Oct, assert **active**.

Plus coupling atomicity: revoking `photo_media` flips every depicting media to `pending_review` in the same transaction (C1); revoking `external_publication` moves a `public_listed` project to `verified` in the same transaction (C2). Each is tested by injecting a mid-coupling failure and asserting neither side changed. And the race: a concurrent revoke and publish on the same item, run in a loop, never both succeed.

## Database guarantee tests

Directly against Postgres: the decision-4 DOB trigger, the form-sourced consent `source_ref` check, evidence-backed `tier_transition` (null `evidence_ref` rejected), the single-active-membership index, the guardian-invite-equals-form-email binding, append-only rejection of update and delete on `consent` and `audit_entry`, the generated `moderation_report.due_at` computing 24 versus 72 hours, the alumni-membership shape (null pod and tier), the impersonation-of-minor read-only trigger, and RLS returning zero cross-pod rows for a query missing its filter.

## The two invariant guards

- **Route manifest.** Every mutating route declares its capability in a manifest. A build test asserts the set of mutating routes discovered in the codebase equals the manifest set. A new endpoint with no entry fails the build.
- **Runtime backstop.** `authorize` records its decision on an `AsyncLocalStorage` context; the repository write layer asserts a decision is present before any mutation and throws otherwise, in every environment.

## Registry completeness meta-test

Every key in `REGISTRY` must have at least one asserted allow and one asserted deny in the sweep, and every value in the `Role` enum must appear as an actor fixture. The build fails otherwise. This is the test that keeps the matrix honest after the person who wrote it graduates.

## Age boundary test

Age resolves in the enrolling chapter's timezone. Test one second before local midnight on the 18th birthday (guardian holds consent write authority, student does not) and one second after (the flip has happened). The same fixture pins the 16 transition and the maturation backstop start.

## self_private negative tests

- A guardian cannot initiate a reset on a `self_private` account; the reset routes to the Chapter Director and the guardian receives nothing.
- A student under 16 cannot transition.
- The transition fails with no `witnessed_by`, and fails if the witness is a guardian of that student.

## account.recover, narrative routing, misc

- `account.recover` is restricted to Chapter Director, audited, and rejected against any account with an active membership; the documented identity check is recorded on the recovery event.
- A `profile_narrative` report with `self_harm_disclosure` receives the 24-hour window and immediate director notification.
- Webhook replay: a repeated Resend or Stripe event id mutates nothing the second time; an unsigned call is refused.
- Scheduled publish: a consent revoked between schedule and send drives the issue to `blocked` and notifies the director rather than sending.

## Test data policy

- Test, CI, and development databases are seeded with synthetic data only, never a production restore.
- The quarterly restore drill runs into an isolated environment with production-equivalent access controls, is time-boxed, is destroyed after verification, and the restore writes an audit entry.
- Fixtures use obviously synthetic names and dates, so a real record appearing in a test database is an immediately visible incident.

## Coverage boundaries, stated honestly

Not covered in the first milestones: UI and accessibility, load and performance, email deliverability itself (only that the webhook updates status), and Luminent sync (which does not exist yet). Where a "must not" depends on operational discipline rather than code, such as a product lead reading the database directly, the test is that the restricted database role lacks the grant, not that a human refrained, which is the only version of that guarantee a test can hold.
