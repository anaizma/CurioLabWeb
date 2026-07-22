# Decision log

For a team that turns over every semester, the reasoning matters more than the conclusion. Each entry records what was decided, what was rejected, and why. The corrections section at the end is deliberately prominent, because those are the places where the obvious answer was wrong.

## Stack

**Role lives on a membership, not the account.** Decided: permissions are computed from the set of memberships plus relationship edges, never a `role` column on the account. Rejected: a flat role column, which breaks permanently the moment a second chapter opens or a person holds two capacities (a Lead Instructor who is also a guardian, an Innovator who becomes a Junior Mentor). This is the one decision most expensive to retrofit, so the membership structure ships even in a reduced v1 role set.

**TypeScript modular monolith with a pure core.** Decided: one repository, a framework-agnostic `core` package, Next.js as a thin frontend and API layer. Rejected: plain Next.js full-stack (compliance code rides on the framework and is painful to unit-test) and a separate Fastify backend from day one (two processes and more ops for a solo founder before it is needed). Rejected Python/Django despite its free admin panel, because it splits the codebase into two languages for a rotating team and its auth wants roles on the user. The pure core is the escape hatch and the test surface; lifting it into a service later still needs an API contract and serialization, which is cheaper than a rewrite, not free.

**PostgreSQL.** Decided, because append-only ledgers, the access matrix, and the many check constraints are database features no other boring database offers together.

**Drizzle, not Prisma.** Decided after re-evaluating with RLS ergonomics as the primary criterion. The compliance-critical layer is raw SQL either way, so the team reads SQL either way; Drizzle keeps the whole data layer in one idiom and makes the per-request RLS pattern transparent, where Prisma treats it as bolted on. Prisma's gentler onboarding is an advantage only for the 90 percent that was never the risk. Zero migration cost because no ORM is installed.

**In-house server-side sessions, no hosted auth, no JWT.** Decided after ruling out self-hosted libraries on evidence, not by skipping the category. Better Auth (the 2026 leader) was tested against five requirements from its own docs: it passes opaque sessions, impersonation with a real-actor field, and admin-created accounts, but fails the decisive one, because its username plugin still requires an email at sign-up and minor students collect no email. JWTs were rejected because instant revocation is required by at least four rulings. The custom part is only the identity model and the invite flows, which no product supports; no cryptography is invented.

**Single always-on container, not serverless.** Decided because the RLS pattern wants pinned connections, the system has real always-on background work, and one process is easier for a rotating team. Note: this was originally argued partly on a nonexistent Next.js fork (see corrections); the conclusion holds on these three real reasons alone.

## Data and authorization

**DOB is one column with provenance.** Decided: `account.date_of_birth` plus `dob_provenance` and `dob_source_ref`, with a trigger requiring `enrollment_record` provenance for any active student. Rejected: splitting the source of truth onto the enrollment record, which invites drift because DOB is immutable per person while a student has several enrollment records.

**Tier lives on the membership with an append-only history.** Decided after this was found missing entirely. Role and tier are orthogonal. `tier_transition` requires a non-null `evidence_ref`, so advancement on demonstrated output is a database rule. University is a separate staff membership, not a fourth tier.

**Consent is append-only, ordered by the guardian's decision.** Decided: order by `effective_at DESC` with `seq` as tiebreaker. See the corrections section, because this was gotten wrong twice before it was gotten right. The signed paper form is the COPPA consent; the digital rows are its ratification, so form-sourced consent rows are created atomically with the enrollment upload and backfilled with `granted_by` at verification.

**`consent_current` is a maintained table, not a view.** Decided because the consent-touching couplings need a stable lock target. This is a requirement settling an open question rather than a taste choice.

**READ COMMITTED with explicit row locks, not SERIALIZABLE.** Decided for the consent-touching couplings: `SELECT ... FOR UPDATE` on the `consent_current` row is the serialization point. Rejected SERIALIZABLE because its retry loops are exactly what a rotating undergraduate team gets wrong silently.

**The platform override never clears consent.** Decided: `platformGrant` is consulted only at the scope and role steps; steps 5 and 6 have no override branch. Rejected the original pipeline short-circuit, which let an admin publish a child's work with no consent. See corrections.

**Guardian access is a scope, not a role, and is enumerated.** Decided: a `guardian` scope with a fixed, small capability set, and `guardian` appears in no chapter-scoped capability, so ruling 6 is structural.

**Subject consent travels on the resource.** Decided so `can` stays pure. A missing snapshot denies `subject_consent_unknown` and fails closed, so a route that forgets to hydrate cannot pass by omission.

**Expiry evaluated at decision time.** Decided: memberships, sessions, and impersonation are checked against `now` in `can`, and the sweeper is demoted to bookkeeping. Rejected relying on the nightly job, which left a stale-active window for an offboarded mentor.

**Internal deny reasons stay internal.** Decided: the client gets one opaque Forbidden; the structured reason goes only to audit. Rejected leaking reasons, which turns the surface into a probe for which children and chapters exist.

## Policy rulings

- **Strictest COPPA path for all minors**, no branching at 13. Cheaper and easier to defend.
- **Grade range is 6 through 12** (documentation corrections below).
- **Two moderation windows**: 24 hours for safety with immediate escalation, 72 for ordinary, with the class driving a generated SLA column and escalation to `platform_admin` for an unresponsive director.
- **Alumni are read-only** unless holding an active mentor membership.
- **Impersonation** is `platform_admin` only, 30 minutes, logged, with a visible banner, and never write-impersonation of a minor (enforced at the database).
- **Billing is external** (Stripe), with a thin reference here; scholarships are the one CurioLab-native money concept.
- **Minors read the feed only with `platform_participation`.** Reading is participation, and the consent-form language says so.
- **The `self_private` credential transition is a witness problem, not a credential problem.** From 16, a student privatizes with a non-guardian chapter adult witnessing, because a guardian holding the child's credentials is cryptographically indistinguishable from the child.
- **The non-email guardian path (`in_person_witnessed`) strengthens the floor** rather than weakening it, and is load-bearing for the families the mission targets.

## Corrections (where the obvious answer was wrong)

**Consent ordering, wrong twice.** The original `effective_at` design was correct, then it was retracted on a flawed scenario, then replaced with `seq` insertion-order, which actually introduced the bug of a late-uploaded form silently overriding an earlier revocation. The final rule is `effective_at DESC` with `seq` as tiebreaker only, because consent is governed by the guardian's most recent decision, not by when the office finished filing. Two tests pin it (form-before-revocation stays inactive; re-grant-after-revocation becomes active).

**The platform override silently outranked consent.** The first authorization design placed the platform override as a pipeline short-circuit ahead of the consent gates, so an admin could publish a child's work with no consent. Consent is a boundary no role clears. The override now means only "satisfies scope and role everywhere."

**The guardian permanently holds a child's credentials.** The registry appears to enforce that guardians have no feed access, but a guardian provisions and can reset the student's credentials, so a guardian can read the feed through the child's account. This is not fully solvable and is partly appropriate for young children. The honest statement is that only the guardian's own feed capability is enforced; the mitigations are visibility (the student sees sign-ins, a reset raises a notice) and the `self_private` path from 16.

**The Next.js fork did not exist.** Three stack arguments leaned on a "modified" or "forked" Next.js. The source was `AGENTS.md` ("this version has breaking changes"), which describes version drift, not a fork. `package.json` pins standard `next@16.2.10`. The container-over-serverless conclusion was re-argued on its real merits. The lesson kept: a version string quoted from a file is a different kind of claim from a characterization built on top of one.

**The schedule was the last thing to get honest.** Artifact 9 wrote the phasing as though fall 2026 was achievable. It is not, for one founder with the legal review as a hard gate. The fall cohort runs on paper; Milestones 0 and 1 target spring 2027.

**Seven-year blanket retention was never lawful under the amended rule.** Locked decision 9 from the brief applied one number to everything. § 312.10 (new in the 2025 amendments) requires retention only as long as reasonably necessary per purpose, forbids indefinite retention, and requires a written policy published in the notice. Retention is now tiered by data class: the verification skeleton and consent evidence keep the seven-year window, but contact details, DOB, and community content age out at active enrollment plus one year. See [compliance-coppa.md](compliance-coppa.md) 1.5.

**The deletion-versus-retention conflict was not a standoff.** It was flagged as needing a legal opinion. § 312.6(a)(2) gives the parent's deletion right priority and § 312.6(c) permits terminating participation as the consequence, so it resolves in the parent's favor by reading the rule. Deletion ends participation and the verification record, stated in the consent form. See [compliance-coppa.md](compliance-coppa.md) 1.6.

**DOB on the enrollment record, reversed and refined.** The original ruling dropped `date_of_birth` from `enrollment_record` to avoid drift, keeping it only on `account`. Implementation revealed the gap: the student account is created after enrollment, so the form's DOB had nowhere to live in between, and the decision-4 trigger would reject activation. The refined ruling: `enrollment_record.date_of_birth` returns, nullable and required only for the seeding enrollment (when `student_account_id IS NULL`); a returning student's later enrollment carries no DOB, so there is no duplicate. Both the enrollment record's value and the account's copy are write-once (triggers forbid ordinary updates), so two immutable values copied once cannot diverge, which was the original worry. Corrections go through an explicit, audited `dob.correct` capability, never an ordinary update. See [02-data-model.md](02-data-model.md).

## Documentation corrections to carry into the vision document

- The vision document says grades 7 through 12 in several places. The ruling is **6 through 12**. Update the document and the site copy.
- The vision document calls Luminent "the operational backbone" and "the primary data store for all operational and learner records." The ruling is that **this platform is authoritative** for tier, project verification, mentor hours, and timeline at launch, with Luminent as a later sync. Update the document.
- The site has copy promising a verification URL that stays live. The ruling is that the URL is **revocable and tied to `public_profile` consent**, returning a neutral not-shared response when withdrawn. Soften the copy.
