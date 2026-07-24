# Mentor-student direct messaging: design and documented-deviation record

Status: **REVIEW-GATED. Built OFF by default, per chapter. Synthetic data only. No real minor is a party until the board, legal counsel, and the insurer have signed off and every enable-precondition below is satisfied in the system.**

Date: 2026-07-24. Branch `feat/platform-m1`. This document is the design plus the board-decision record for a supervised one-on-one messaging channel between an assigned mentor and an assigned student. Decisions locked with the program lead (2026-07-24): (1) start with this document; (2) the safety officer is a distinct per-chapter role that is never a mentor or student; (3) a mentor-student pair is authorized by pod assignment plus DM consent plus current mentor eligibility.

This is the highest-risk surface in the platform. The technical controls below are necessary and not sufficient; the human layer in Part C.9 is what actually protects children, and the enable-preconditions in Part D make the human layer a gate rather than a policy.

---

## Part A. Documented deviation (board-decision record)

This part is written for a reader who is not an engineer: an insurer, an auditor, or a court. It records that the organization considered the recognized standard, chose a different approach deliberately, and put compensating controls in place. Undocumented deviation reads as ignorance. Documented deviation reads as risk management. **This part requires board ratification (sign-off block at the end); the engineering team drafts it, the board adopts it.**

### A.1 The recognized standard
The youth-protection standard for adult-minor interaction is "two-deep" leadership and no one-on-one adult-minor contact: an adult is never alone with a child, in person or in private digital communication. Applied literally to messaging, it forbids a private mentor-student thread.

### A.2 The decision
The organization chooses to permit one-on-one mentor-student messaging that is **observable rather than private**: the thread feels direct to the two participants but is structurally readable, at all times and without either participant's ability to prevent it, by a named chapter safety officer and by the student's guardian, and is permanently retained. The organization judges an observed one-on-one channel, with the compensating controls in A.4, to be an acceptable and supervised substitute for two-deep in the digital-messaging context, and preferable to the realistic alternative of mentors and students moving to unmonitored personal channels (SMS, social platforms) that the organization cannot see at all.

### A.3 Why (the reasoning the board adopts)
- A monitored on-platform channel is more protective than driving contact to invisible personal channels, which is what happens in practice when a program offers no sanctioned option.
- The deterrent value of visible, permanent, four-party observation is substantial: an adult who knows they are observed behaves differently, and that deterrent does more work than after-the-fact review.
- The controls below instrument the relationship, not only the words, which is where documented abuse cases actually show up.

### A.4 Compensating controls, mapped to the risk each addresses

| Control | Risk it addresses |
|---|---|
| Four-party standing read access (participants, safety officer, guardian); no party removable | Privacy that enables grooming; removes the "just between us" space |
| Permanent visibility header stated identically to all parties | The deterrent of known observation; informed-monitoring of the minor |
| No deletion, no editing, no ephemerality, by anyone, ever | Deletion is the first move in documented cases; preserves evidence |
| Access is a grant scoped to a current assignment, auto-expiring at cohort end | No standing access to a child; no lingering access after the relationship ends |
| Access requires current background check, reporter training, code of conduct, and DM-specific guardian consent; any lapse cuts access immediately | Ensures only vetted, trained, consented adults ever have a channel |
| Closed hours (default 21:00-07:00 local, per-chapter configurable) | Late-night one-on-one contact has no program purpose |
| Attachment asymmetry (mentor to student: links/documents only; student to mentor: images held for safety-officer review before delivery) | Image exchange is a categorically worse risk than text |
| Content flags routed to a human, not auto-blocked (contact info, secrecy framing, off-platform moves, in-person arrangements, romantic/appearance language, home-life probing) | The careless offender; surfaces the language patterns of grooming |
| Behavioral signals computed weekly per mentor-student pair, ranked for review | The relational pattern that keyword filters miss (volume, velocity, asymmetry, edge-hours) |
| Named safety officer who is not a peer of the mentors and not a student | Peer review does not escalate; independence is the point |
| Written review protocol (100% of flagged threads in 48h; weekly random sample; full review of a mentor's final week; every review logged, including nil findings) | Demonstrates a functioning program; catches what signals miss |
| Low-stakes student report affordance ("Something feels off") to the safety officer, no mentor notification | A minor who is unsure will not press a button labeled "Report abuse" |
| Guardian weekly digest by default, immediate notification on any flag | Passive access plus an active nudge is what makes review actually happen |
| Retention past the student's majority; messaging is a carve-out from the right-to-deletion policy, disclosed at consent | Ohio civil limitations for childhood claims extend well past 18; destroying later-evidence is a serious problem |
| Every safety-officer and guardian read logged in the append-only monitoring ledger | Monitoring that is not itself auditable is a capability waiting to be abused |
| Abuse-and-molestation insurance confirmed before the first message | General liability commonly excludes it |

### A.5 Preconditions to enable (organizational)
Before DM is enabled for any chapter: a named safety officer meeting the independence criterion is recruited and assigned; the written review protocol is adopted; the escalation and mandatory-reporter path (including who contacts Ohio's child-abuse hotline and under what circumstances) is written and delivered to mentors at onboarding; abuse-and-molestation insurance coverage is confirmed; legal counsel has reviewed the COPPA posture change in Part B and the consent disclosure in Part C.10. The software enforces the system-checkable subset of these (Part D).

### A.6 Board ratification
> On ______ the board of CurioLab reviewed the two-deep standard, considered the alternative of prohibiting mentor-student messaging entirely, and adopted the observed-one-on-one model with the compensating controls in A.4 as its youth-protection approach for digital messaging. Named safety officer(s): ______. Insurance carrier and policy confirming abuse-and-molestation coverage: ______. Counsel review of the COPPA posture change (Part B): ______.
>
> Signed: ______ (Board Chair), ______ (date).

---

## Part B. Compliance posture change (for counsel, before any enable)

**This feature changes the platform's COPPA position and must not be enabled until counsel signs off.**

The platform's standing position is that a student's username is not "personal information" under 16 CFR 312.2, because a username functions as personal information only where it permits direct contact, and CurioLab usernames could not be messaged. A committed guard (`packages/core/src/messaging-guard.ts`, test `no-direct-messaging.test.ts`) enforces that position by failing the build the moment any student-contactable messaging capability is added. Feature 3 (guardian-staff messaging) was exempted only because it is adult-to-adult and a student is never a party.

Mentor-student DM deliberately makes a student contactable. Two consequences:

1. **The username-is-not-PII argument must be re-examined by counsel.** A defensible narrower position is available: contact is not possible by knowing an identifier; it requires an existing pod assignment, a guardian consent grant, and current mentor eligibility, so the channel is relationship-scoped, not username-scoped, and a username still does not by itself permit contact. Whether that holds is a legal judgment, not an engineering one. The alternative is to treat student usernames as PII going forward and adjust handling accordingly. Counsel decides.
2. **The no-direct-messaging guard must be amended deliberately and very narrowly**, not bypassed. Any exemption must key on the fully-gated shape (assignment-scoped, consent-gated, eligibility-gated, safety-officer-present, feature-enabled) and must still trip for any broader student messaging (student-to-student, unassigned pairs, un-consented, or un-monitored). The amendment is itself a compliance artifact and is reviewed with counsel. Until then the guard trips and the build stays red for this feature, which is the correct default.

---

## Part C. Technical design

### C.1 The safety officer (new role)
A new chapter-scoped principal `safety_officer`, assigned per chapter to a specific adult who is **not a mentor and not a student in that chapter** (enforced in the assignment path). A director may hold it only if they mentor no students in that chapter; otherwise it must be a separate non-peer adult (faculty advisor or board member). Powers: read every DM thread in their chapter; review and resolve flags; receive flag notifications; initiate the guarded guardian-visibility suspension (C.8). Assigning a safety officer is a director/admin action and is a hard precondition for enabling DM in the chapter.

### C.2 The four-party thread
A DM thread has exactly two participants (the assigned mentor and the assigned student) and four parties with standing read access: the two participants, the chapter safety officer, and the student's guardian(s). No party can remove another. Every thread carries a permanent, non-dismissible visibility header, worded identically to all parties, naming the safety officer and stating that the conversation is saved permanently, readable by the safety officer and the guardian, and cannot be deleted by either participant. Append-only: messages are never edited or deleted (same mechanism as Feature 3 and the rest of the platform).

### C.3 Provisioning: the DM eligibility predicate
A pure, testable predicate `canDirectMessage(mentor, student, now)` that is true only when ALL hold:
- **Assignment:** the student is in a pod the mentor is assigned to, in the current term (reuse pod assignment; cohort == term).
- **DM consent:** a current (non-expired, non-revoked) `mentor_dm` guardian consent grant is on file for that student. This is a new grant type in the P6a consent grant-ledger, independently revocable, expiring at term end. Capture method configurable per chapter (default click; the org may elevate to signed_form).
- **Mentor eligibility current:** `evaluateMentorEligibility` (P6b) passes: background check, reporter training, CWRU-affiliation, code of conduct, all satisfied and unexpired.
- **Chapter enabled:** the chapter DM switch is on, which itself requires an assigned safety officer and a recorded insurance attestation (Part D).

Any of these lapsing cuts access immediately, with no human remembering: the predicate is re-evaluated at every send and read, and the existing eligibility and time-box sweeps (P5/P6b) already revoke on lapse. Students cannot initiate with unassigned mentors and mentors cannot with unassigned students. No student-to-student DM in v1 (a separate risk surface with its own moderation burden; bundling it is out of scope by decision).

### C.4 Structural constraints
- **Hours:** sends refused outside 07:00-21:00 local, configurable per chapter. Reads are unrestricted.
- **Deletion / editing / ephemerality:** none, by anyone, ever. Enforced at the database (append-only trigger + revoked grants), not only in code.
- **Attachments:** mentor to student, links and documents only (no images or video). Student to mentor, images allowed but placed in a `held` state and routed to the safety officer, delivered to the mentor only after the safety officer releases them. Model as an attachment row with a `hold|released|withheld` state; the mentor never sees a held image. (Attachments may be a later phase; the model reserves for it.)
- **Off-platform contact info:** contact-info patterns in a draft are detected and the sender sees an interstitial before the message sends (the interstitial is frontend; the backend flags and records). Friction at the migration point, not a block.
- **Export:** guardian and student can export the full thread on demand (reuse the export-request machinery).

### C.5 Detection: content flags (human-routed, not auto-blocked)
Pattern matchers that raise a flag (append-only `dm_flag` row) routed to the safety officer, never an auto-block, for: contact info (phone, email, social handle, off-platform link); language about moving the conversation elsewhere; secrecy framing (do not tell, between us, our thing, delete this); arranging in-person contact outside program events, offers of rides or gifts; romantic or appearance-focused language; probing about the student's home life that reads as testing for isolation. Matchers are data-driven and tunable; a flag records the matched category and the message, not a verdict.

### C.6 Detection: behavioral signals (the higher-signal ones)
Computed weekly per mentor-student pair by a `runDmSignals({sql}, now)` job body (deterministic injected `now`, no live scheduler; same pattern as the other sweeps), each with a **configurable threshold** and surfaced as a **raw value plus a rank**, never only a verdict:
- One mentor's message volume with a single student far exceeding that mentor's baseline across their other students.
- Message velocity spiking week over week in one thread.
- Repeated send attempts at the edges of allowed hours.
- Sharply asymmetric initiation (the mentor consistently starting).
- A pair's threads much longer than the cohort norm.

Separate track (does **not** contribute to the mentor's risk score): the guardian has never opened the thread. That is a supervision signal about the parent, and it triggers a guardian nudge, not a mentor flag.

Output feeds the safety-officer dashboard as a ranked list of pairs, so review is "read the top of a ranked list," not "read everything," which is the only version a small volunteer team can sustain.

### C.7 Monitoring ledger
Every safety-officer read and every guardian read of a DM thread is an append-only monitoring-ledger entry (who, when, which thread), alongside every flag raised/reviewed/resolved, every attachment hold/release, and every guardian-visibility suspension. This extends the existing access ledger. Monitoring that is not itself auditable is a capability waiting to be abused.

### C.8 Guardian visibility and the suspend guardrail
Guardian standing read access is the default and is not removable by a participant. The uncomfortable case is that for some students the guardian is the risk. The safety officer, and only the safety officer, can suspend guardian visibility on that student's thread, but only through a guarded flow: it requires a recorded reason, is time-boxed with a review date, is logged in the monitoring ledger, and (recommended) requires a second adult's acknowledgement. It is never a quiet toggle. This capability is powerful enough to be an abuse vector inverted, so it is held to the same documentation-and-audit standard as the monitoring itself.

### C.9 The human layer (the part that actually protects children)
Software cannot do this and it is where small programs fail. Named independent safety officer (C.1). Written review protocol: 100% of flagged threads within 48 hours, plus a weekly random sample of unflagged threads, plus a full review of any thread in a mentor's final week; log every review including nil findings. Escalation and mandatory-reporter path written before it is needed, delivered at onboarding. Abuse-and-molestation insurance confirmed before the first message. The software makes the system-checkable parts of this preconditions (Part D); the rest is organizational and recorded in Part A.

### C.10 Consent and disclosure
`mentor_dm` is its own grant in the guardian portal, separate and independently revocable, re-confirmed per cohort (not once forever). The disclosure states in plain language: messages are permanent; who can read them (the mentor, the student, the named safety officer, and the guardian); the guardian can read them at any time; a mentor cannot delete anything; the messaging logs are retained past the student's 18th birthday and are a deliberate carve-out from the right-to-deletion policy, with the reason; and what the guardian will be notified about (weekly digest, immediate on a flag).

### C.11 Retention carve-out (integration point, not just disclosure)
DM threads and messages are excluded from deletion-request fulfillment (the deletion-fulfill service must skip `dm_thread`/`dm_message`) and retained until a configurable interval past the student's 18th birthday (default set with counsel, e.g. 7 years). This is a real change to the existing right-to-deletion path and is wired, then disclosed at consent in the words above.

### C.12 Student-side safety
A report affordance inside the thread labeled low-stakes ("Something feels off"), routing to the safety officer, not notifying the mentor, not looking dramatic. A path to a second adult who is not the mentor. And a plain statement, visible to the student, of who can read the thread. A monitored minor is entitled to know they are monitored.

### C.13 Endpoints (sketch; specified in the build phase)
- Participants: send and read within an authorized pair; the "something feels off" report.
- Safety officer: the ranked dashboard, chapter thread list and detail, flag review/resolve, attachment release, the guarded guardian-visibility suspension.
- Guardian: read the child's threads, export, the weekly digest data.
- Director/admin: enable DM for a chapter (gated on preconditions), assign the safety officer, record the insurance attestation.
All chapter-scoped, `{ items: [...] }` envelopes, append-only, opaque 403.

### C.14 Capabilities and the guard amendment
New capabilities (chapter-scoped unless noted): `dm.message` (mentor and student write, scoped to an authorized pair), `dm.read_own`, `dm.oversee` (safety officer read plus flag review), `dm.suspend_guardian_visibility` (safety officer, guarded), `dm.enable` (director/admin, gated on preconditions), `safety_officer.assign` (director/admin). The no-direct-messaging guard is amended (Part B) with a narrow exemption keyed on the fully-gated shape, with tests proving any broader student-messaging shape still trips. This lands only after counsel sign-off; until then the guard trips by design.

---

## Part D. Enable-preconditions (software-enforced gate)
`dm.enable` for a chapter refuses unless, in the system: a `safety_officer` is assigned to the chapter and is not a mentor or student there; an insurance-confirmed attestation row is recorded for the chapter; and the chapter has at least one current-term pod (so assignment is meaningful). At the pair level, `canDirectMessage` additionally requires the mentor's current eligibility and the `mentor_dm` consent grant (C.3). A global build flag `MENTOR_DM_ENABLED` (default false, `=== 'true'`) gates the entire feature off until counsel and board sign-off, mirroring `CONSENT_GRANT_LEDGER_ENFORCED` and `MENTOR_ELIGIBILITY_ENFORCED`. Off means the mechanism is built and tested but no DM route accepts a real send.

## Part E. Build phases (mechanism-first, each verified with the full suite and a clean build, review-gated)
1. **Model and provisioning:** the `safety_officer` role + assignment (with the not-a-peer enforcement), the `mentor_dm` consent grant type, the `dm_thread`/`dm_message` append-only tables with the four-party access model and the visibility header, and the `canDirectMessage` predicate. Guard amendment (behind counsel note) + the enable-precondition gate. Off by default.
2. **Structural constraints:** hours, attachment hold/release, contact-info detection + interstitial flagging, export, the retention carve-out in deletion-fulfill.
3. **Detection:** content-flag matchers + the `dm_flag` table + routing; the behavioral-signals job + the ranked output; the monitoring ledger extension; the guarded guardian-visibility suspension.
4. **Surfaces:** the participant send/read + report endpoints, the safety-officer dashboard + review endpoints, the guardian read/export/digest endpoints, the director enable/assign/attest endpoints.
5. **Pilot support:** two or three mentors and a small student group for a full cohort before opening up, to test the review protocol and the false-positive rate, not the code. The go/no-go for real minors is a board, counsel, and insurance decision, not an engineering one.

## Open decisions for the program lead
- `mentor_dm` capture method: click (default) or require signed_form given the risk.
- Retention interval past majority (set with counsel; default 7 years pending).
- Whether the guardian-visibility suspension requires a second adult's acknowledgement (recommended) or the safety officer alone with logging.
- Whether attachments are in the first build or deferred (the model reserves for them either way).
