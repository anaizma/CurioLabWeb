# Mentor-student direct messaging: design and documented-deviation record

Status: **REVIEW-GATED. Built OFF by default, per chapter. Synthetic data only. No real minor is a party until the board, legal counsel, and the insurer have signed off and every enable-precondition below is satisfied in the system.**

Date: 2026-07-24 (rev 2). Branch `feat/platform-m1`. This document is the design plus the board-decision record for a supervised one-on-one messaging channel between an assigned mentor and an assigned student.

Decisions locked with the program lead (2026-07-24): (1) start with this document; (2) the safety officer is a distinct per-chapter role, never a mentor or student; (3) a mentor-student pair is authorized by pod assignment plus DM consent plus current mentor eligibility; (4) DM consent is captured as a **signed form**; (5) retention runs to the **outer bound of Ohio's childhood-claim limitations window** (counsel to confirm the exact age; working assumption ~age 30, not a round number); (6) guardian-visibility suspension requires **two adults, a 90-day expiry, and a mandatory-reporter checkpoint**; (7) **attachments are deferred entirely; v1 is text-only**; (8) at this scale the safety officer **reads everything**, so oversight is full-coverage with read-receipts, not a ranked sample.

This is the highest-risk surface in the platform. The technical controls are necessary and not sufficient; the human layer in Part C.9 is what actually protects children, and the enable-preconditions in Part D make the system-checkable parts of it a gate rather than a policy.

---

## Part A. Documented deviation (board-decision record)

Written for a reader who is not an engineer: an insurer, an auditor, or a court. It records that the organization considered the recognized standard, chose a different approach deliberately, and put compensating controls in place. **Requires board ratification (sign-off block at A.7); engineering drafts it, the board adopts it.**

### A.1 The recognized standard
The youth-protection standard for adult-minor interaction is "two-deep" leadership and no one-on-one adult-minor contact: an adult is never alone with a child, in person or in private digital communication. Applied literally to messaging, it forbids a private mentor-student thread.

### A.2 The decision
The organization permits one-on-one mentor-student messaging that is **observable rather than private**: the thread feels direct to the two participants but is structurally readable, at all times and without either participant's ability to prevent it, by a named chapter safety officer and by the student's guardian, and is permanently retained. The organization judges an observed one-on-one channel, with the compensating controls in A.4, to be an acceptable supervised substitute for two-deep in the digital-messaging context, and preferable to the realistic alternative of mentors and students moving to unmonitored personal channels the organization cannot see at all.

### A.3 Why (the reasoning the board adopts)
- A monitored on-platform channel is more protective than driving contact to invisible personal channels, which is what a program that offers no sanctioned option gets in practice.
- The deterrent value of visible, permanent, four-party observation is substantial: an adult who knows they are observed behaves differently, and that deterrent does more work than after-the-fact review.
- The controls instrument the relationship, not only the words, which is where documented abuse cases actually show up.

### A.4 Compensating controls, mapped to the risk each addresses

| Control | Risk it addresses |
|---|---|
| Four-party standing read access (participants, safety officer, guardian); no party removable | Privacy that enables grooming; removes the "just between us" space |
| Permanent visibility header stated identically to all parties | The deterrent of known observation; informed monitoring of the minor |
| No deletion, no editing, no ephemerality, by anyone, ever | Deletion is the first move in documented cases; preserves evidence |
| Access is a grant scoped to a current assignment, auto-expiring at cohort end | No standing access to a child; no lingering access after the relationship ends |
| Access requires current background check, reporter training, code of conduct, and a **signed** DM consent form from the guardian; any lapse cuts access immediately | Only vetted, trained, consented adults get a channel; the signed form tests guardian engagement, which is itself a control |
| **Safety officer reads 100% of messages**, with a read-receipt per thread and full-coverage recorded in the ledger | At this scale, sampling would leave threads unread while looking like oversight |
| Content flags routed to a human, not auto-blocked (contact info, secrecy framing, off-platform moves, in-person arrangements, romantic/appearance language, home-life probing), pinned to the top of the reading queue | The careless offender; surfaces the language patterns of grooming for priority reading |
| Closed hours (default 21:00-07:00 local, per-chapter configurable) | Late-night one-on-one contact has no program purpose |
| **Text only in v1; no image or file exchange** | A minor-image review queue is a categorically worse risk with its own CSAM/NCMEC handling burden (see C.4) |
| Named safety officer who is not a peer of the mentors and not a student | Peer review does not escalate; independence is the point |
| **Oversight of the safety officer:** the officer cannot modify the append-only ledger, and it goes to the board quarterly as a standing agenda item with thread-review and flag counts | The person with read access to every minor's private messages is themselves a concentration of risk |
| Guardian-visibility suspension requires two adults (the second not a mentor in that chapter), expires in 90 days, and surfaces a mandatory-reporter checkpoint at the moment of suspension | The "guardian is the risk" case, without creating an unwatched adult-reads-minor capability |
| Written review protocol; every review logged, including nil findings; a red-team grooming exercise run against the pilot | Demonstrates a functioning program; proves the detection and the human both fire |
| Low-stakes student report affordance ("Something feels off") to the safety officer, no mentor notification, preceded by a first-open onboarding screen | A minor who is unsure will not press a button labeled "Report abuse", and cannot use one they do not know exists |
| Guardian weekly digest by default, immediate notification on any flag | Passive access plus an active nudge is what makes review actually happen |
| Retention to the outer bound of the limitations period; messaging is a carve-out from the right-to-deletion policy, disclosed at consent; DM store encrypted at rest with tight access control | Ohio childhood-claim windows extend well past 18; shorter-than-window retention carries the breach surface and still lacks the record when needed |
| Every safety-officer and guardian read logged in the append-only monitoring ledger | Monitoring that is not itself auditable is a capability waiting to be abused |
| Mentor-departure handling: threads freeze and preserve, the student is handed off, and a safety-officer conversation is decided in advance | An improvised response on the day a mentor is removed for cause is the wrong time to decide |
| Abuse-and-molestation insurance confirmed before the first message | General liability commonly excludes it |

### A.5 Preconditions to enable (organizational)
Before DM is enabled for any chapter: a named safety officer meeting the independence criterion is recruited and assigned; the written review protocol is adopted; the escalation and mandatory-reporter path (including who contacts Ohio's child-abuse hotline and under what circumstances) is written and delivered to mentors at onboarding; abuse-and-molestation insurance coverage is confirmed; legal counsel has reviewed the COPPA posture change (Part B), the retention interval (C.11), and the consent disclosure (C.10). The software enforces the system-checkable subset (Part D).

### A.6 Built does not mean approved
The mechanism is built dark against synthetic data while approvals are sought (Part E sequencing). **Building it creates no obligation to enable it.** Finished work generates a pull toward ratification that a proposal does not, and resisting that pull is precisely why this deviation document exists. The board evaluates the completed system as it would a proposal: the right decision remains available to decline, to scope down, or to require changes, and a "no" after the build is a legitimate and cost-justified outcome.

### A.7 Board ratification
> On ______ the board of CurioLab reviewed the two-deep standard, considered the alternative of prohibiting mentor-student messaging entirely, understood that the system is already built and that this imposes no obligation to enable it, and adopted the observed-one-on-one model with the compensating controls in A.4 as its youth-protection approach for digital messaging. Named safety officer(s): ______. Insurance carrier and policy confirming abuse-and-molestation coverage: ______. Counsel review of the COPPA posture change (Part B) and the retention interval (C.11): ______.
>
> Signed: ______ (Board Chair), ______ (date).

---

## Part B. Compliance posture change (for counsel, before any enable)

**This feature changes the platform's COPPA position and must not be enabled until counsel signs off.**

The platform's standing position is that a student's username is not "personal information" under 16 CFR 312.2, because a username functions as personal information only where it permits direct contact, and CurioLab usernames could not be messaged. A committed guard (`packages/core/src/messaging-guard.ts`, test `no-direct-messaging.test.ts`) enforces that position by failing the build the moment any student-contactable messaging capability is added. Feature 3 (guardian-staff messaging) was exempted only because it is adult-to-adult and a student is never a party.

Mentor-student DM deliberately makes a student contactable. Two consequences:
1. **The username-is-not-PII argument must be re-examined by counsel.** A narrower defensible position: contact requires an existing pod assignment, a guardian consent grant, and current mentor eligibility, so the channel is relationship-scoped, not username-scoped, and a username still does not by itself permit contact. Whether that holds is a legal judgment. The alternative is to treat student usernames as PII going forward and adjust handling. Counsel decides.
2. **The no-direct-messaging guard is amended deliberately and very narrowly**, not bypassed. Any exemption keys on the fully-gated shape (assignment-scoped, consent-gated, eligibility-gated, safety-officer-present, feature-enabled) and must still trip for any broader student messaging (student-to-student, unassigned pairs, un-consented, un-monitored). The amendment is itself a compliance artifact reviewed with counsel. Until then the guard trips and the build stays red for this feature, which is the correct default.

---

## Part C. Technical design

### C.1 The safety officer (new role)
A new chapter-scoped principal `safety_officer`, assigned per chapter to a specific adult who is **not a mentor and not a student in that chapter** (enforced in the assignment path). A director may hold it only if they mentor no students in that chapter; otherwise it must be a separate non-peer adult (faculty advisor or board member). Powers: read every DM thread in their chapter; review and flag; receive flag notifications; initiate the guarded guardian-visibility suspension (C.8). The officer cannot modify the ledger and is themselves audited (C.7). Assigning a safety officer is a director/admin action and a hard precondition for enabling DM in the chapter.

### C.2 The four-party thread
Exactly two participants (the assigned mentor and the assigned student) and four parties with standing read access: the two participants, the chapter safety officer, and the student's guardian(s). No party can remove another. Every thread carries a permanent, non-dismissible visibility header, worded identically to all parties, naming the safety officer and stating that the conversation is saved permanently, readable by the safety officer and the guardian, and cannot be deleted by either participant. Append-only: messages are never edited or deleted (same mechanism as Feature 3).

### C.3 Provisioning: the DM eligibility predicate
A pure, testable predicate `canDirectMessage(mentor, student, now)`, true only when ALL hold:
- **Assignment:** the student is in a pod the mentor is assigned to, in the current term (cohort == term).
- **DM consent:** a current (non-expired, non-revoked) `mentor_dm` guardian consent grant is on file for that student. This is a new grant type in the P6a consent grant-ledger, independently revocable, expiring at term end. **Capture method is `signed_form`**, routed through the same upload flow as the `public_publication` grant so a family completes one document event, not two. The signed form is deliberate friction: a guardian who will not return one form is the guardian who will never open the thread, and the program wants to learn that before enabling the channel, not after. Guardian engagement is a load-bearing control in this design, and a click would establish nothing about it.
- **Mentor eligibility current:** `evaluateMentorEligibility` (P6b) passes: background check, reporter training, CWRU-affiliation, code of conduct, all satisfied and unexpired.
- **Chapter enabled:** the chapter DM switch is on, which requires an assigned safety officer and a recorded insurance attestation (Part D).

Any of these lapsing cuts access immediately, with no human remembering: the predicate is re-evaluated at every send and read, and the existing eligibility and time-box sweeps (P5/P6b) already revoke on lapse. Students cannot initiate with unassigned mentors and mentors cannot with unassigned students. No student-to-student DM in v1.

### C.4 Structural constraints
- **Text only in v1. No attachments of any kind.** The deferral is deliberate, not incidental: a student-to-mentor image queue is a job in which a volunteer reviews potentially sexualized images of minors, and a single item that is CSAM puts the safety officer in possession of it, where the correct path is an immediate NCMEC report, not a review decision. That queue requires a written handling protocol, a legal escalation path, and likely hash-matching before it can exist. Attachments are their own future project with their own counsel review; they are not "reserved for later" in this design, they are out.
- **Hours:** sends refused outside 07:00-21:00 local, configurable per chapter. Reads unrestricted.
- **Deletion / editing / ephemerality:** none, by anyone, ever. Enforced at the database (append-only trigger), not only in code.
- **Off-platform contact info:** contact-info patterns in a draft are detected and the sender sees an interstitial before the message sends (interstitial is frontend; the backend flags and records). Friction at the migration point, not a block.
- **Export:** guardian and student can export the full thread on demand (reuse the export-request machinery).

### C.5 Detection: content flags (human-routed, not auto-blocked)
Pattern matchers that raise an append-only `dm_flag` routed to the safety officer, never an auto-block, for: contact info (phone, email, social handle, off-platform link); moving the conversation elsewhere; secrecy framing (do not tell, between us, our thing, delete this); arranging in-person contact outside program events, offers of rides or gifts; romantic or appearance-focused language; probing about the student's home life that reads as testing for isolation. Matchers are data-driven and tunable; a flag records the matched category and the message, not a verdict. Flagged items pin to the top of the reading queue (C.6).

### C.6 Oversight: full-coverage reading queue (not a ranked sample)
At this scale, ranked behavioral signals are the wrong design and would create the illusion of monitoring while letting unflagged threads go unread. A single chapter of a handful of mentors with two or three students each does not have the volume for a baseline: "this mentor's volume with one student exceeds their baseline" is a comparison across n=3, and velocity spikes and asymmetric initiation are noise at that size. The honest design is that **the safety officer reads everything.** Sixteen students and a few mentors generate on the order of a couple hundred messages a week, roughly fifteen minutes of reading.

The safety-officer surface is therefore a **complete chronological reading queue** with flagged items (C.5) pinned to the top and a **read-receipt per thread**, so the monitoring ledger records 100% coverage rather than a sample. A defined **transition trigger** (a configurable weekly-message-volume threshold beyond which full review becomes infeasible) is the point at which sampling and behavioral ranking get designed and built, not before. Behavioral signals are documented here as a deliberately deferred, scale-triggered future capability, not part of v1.

Separate track (never part of a mentor's risk assessment): the guardian has never opened the thread. That is a supervision signal about the parent and triggers a guardian nudge, not a mentor flag.

### C.7 Monitoring ledger and oversight of the officer
Every safety-officer read and every guardian read of a DM thread is an append-only monitoring-ledger entry (who, when, which thread), alongside every flag raised/reviewed/resolved, every guardian-visibility suspension, and the per-thread read-receipts. This extends the existing access ledger. The safety officer **cannot modify** the ledger. A quarterly export (threads reviewed, coverage, flags raised and their disposition, suspensions) goes to the board as a standing agenda item. The officer holds read access to every minor's private messages and is therefore audited like any other concentration of risk.

### C.8 Guardian visibility and the suspend guardrail
Guardian standing read access is the default and is not removable by a participant. For some students the guardian is the risk. The safety officer, and only the safety officer, can suspend guardian visibility on that student's thread, through a guarded flow that requires: a recorded reason; a **second adult's acknowledgement, where the second adult is not a mentor in that chapter**; a **90-day expiry** after which visibility restores unless affirmatively re-authorized (it never persists silently); and a **mandatory-reporter checkpoint surfaced at the moment of suspension**, because suspending guardian visibility on the theory that the guardian may be the risk is very likely already reportable-suspicion territory, and the interface says so and names the Ohio hotline rather than leaving it to the officer's judgment under stress. Every suspension is logged in the monitoring ledger.

### C.9 The human layer (the part that actually protects children)
Software cannot do this and it is where small programs fail. Named independent safety officer (C.1). Written review protocol: 100% of messages read (C.6), flagged threads reviewed within 48 hours, a full review of any thread in a mentor's final week, every review logged including nil findings, and the officer themselves audited (C.7). Escalation and mandatory-reporter path written before it is needed and delivered at onboarding. Abuse-and-molestation insurance confirmed before the first message. A red-team exercise in the pilot (Part E). The software makes the system-checkable parts preconditions (Part D); the rest is organizational and recorded in Part A.

### C.10 Consent and disclosure
`mentor_dm` is its own grant in the guardian portal, separate and independently revocable, captured as a signed form (C.3), re-confirmed per cohort. The disclosure states in plain language: messages are permanent; who can read them (the mentor, the student, the named safety officer, and the guardian); the guardian can read them at any time; a mentor cannot delete anything; the messaging logs are retained past the student's 18th birthday to the outer bound of the limitations period and are a deliberate carve-out from the right-to-deletion policy, with the reason; and what the guardian will be notified about (weekly digest, immediate on a flag).

### C.11 Retention carve-out and encryption at rest
DM threads and messages are excluded from deletion-request fulfillment (the deletion-fulfill service skips `dm_thread`/`dm_message`) and retained to the **outer bound of Ohio's childhood-claim limitations window** (counsel to confirm the exact age; working placeholder ~age 30). Shorter-than-window retention is the worst configuration: it carries the breach surface of storing minors' messages and still lacks the record on the day it is needed. Because text is essentially free to store, the real cost is breach exposure, which argues for **encryption at rest on the DM message store plus tight access control**, not earlier deletion. The platform has no column-encryption seam today (the same gap noted for the TOTP secret), so building that seam is a **Phase 1 dependency** for this feature and also closes the TOTP gap. This is a real change to the existing right-to-deletion path, wired then disclosed at consent in the words above.

### C.12 Student-side safety
A report affordance inside the thread labeled low-stakes ("Something feels off"), routing to the safety officer, not notifying the mentor, not looking dramatic. A path to a second adult who is not the mentor. A plain statement, visible to the student, of who can read the thread. And a **first-open onboarding screen**, shown the first time a student opens any thread: in plain language, who reads this, what happens when you report, and that reporting does not get anyone in trouble by default. The report button only works if the student already knows it exists and what pressing it costs.

### C.13 Surfaces (sketch; specified in the build phase)
- Participants: send and read within an authorized pair; the first-open onboarding screen; the "something feels off" report.
- Safety officer: the complete chronological reading queue with flags pinned and per-thread read-receipts; thread detail; flag review/resolve; the guarded guardian-visibility suspension; the quarterly oversight export.
- Guardian: read the child's threads, export, the weekly digest data.
- Director/admin: enable DM for a chapter (gated on preconditions), assign the safety officer, record the insurance attestation.
All chapter-scoped, `{ items: [...] }` envelopes, append-only, opaque 403.

### C.14 Capabilities and the guard amendment
New capabilities (chapter-scoped unless noted): `dm.message` (mentor and student write, scoped to an authorized pair), `dm.read_own`, `dm.oversee` (safety officer read plus flag review plus read-receipt), `dm.suspend_guardian_visibility` (safety officer, guarded), `dm.enable` (director/admin, gated on preconditions), `safety_officer.assign` (director/admin). The no-direct-messaging guard is amended (Part B) with a narrow exemption keyed on the fully-gated shape, with tests proving any broader student-messaging shape still trips. Lands only after counsel sign-off; until then the guard trips by design.

### C.15 Mentor departure mid-cohort
When a mentor is removed, especially for cause, `canDirectMessage` already goes false the moment their eligibility or assignment is revoked (C.3), so no new messages flow. Beyond that automatic cut: the affected threads **freeze and preserve** (never delete), the student is handed off to a successor mentor or told plainly that the channel is paused, and whether that student gets a direct conversation with the safety officer is decided in advance by the review protocol rather than improvised on the day. The frozen threads remain readable to the safety officer and guardian and under the retention policy.

---

## Part D. Enable-preconditions (software-enforced gate)
`dm.enable` for a chapter refuses unless, in the system: a `safety_officer` is assigned to the chapter and is not a mentor or student there; an insurance-confirmed attestation row is recorded for the chapter; the DM message store's encryption-at-rest seam is present (C.11); and the chapter has at least one current-term pod (so assignment is meaningful). At the pair level, `canDirectMessage` additionally requires the mentor's current eligibility and the signed `mentor_dm` consent grant (C.3). A global build flag `MENTOR_DM_ENABLED` (default false, `=== 'true'`) gates the entire feature off until counsel and board sign-off, mirroring `CONSENT_GRANT_LEDGER_ENFORCED` and `MENTOR_ELIGIBILITY_ENFORCED`. Off means the mechanism is built and tested but no DM route accepts a real send.

## Part E. Build phases (mechanism-first, each verified with the full suite and a clean build, review-gated)
1. **Model and provisioning:** the column-encryption-at-rest seam (C.11) first; then the `safety_officer` role + assignment (with the not-a-peer enforcement), the `mentor_dm` signed-form consent grant type, the `dm_thread`/`dm_message` append-only encrypted tables with the four-party access model and the visibility header, and the `canDirectMessage` predicate. Guard amendment (behind counsel note) + the enable-precondition gate. Off by default.
2. **Structural constraints:** hours, off-platform contact-info flagging, export, and the retention carve-out in deletion-fulfill. No attachments.
3. **Detection and oversight:** content-flag matchers + `dm_flag` + routing; the full-coverage chronological reading queue with pinned flags and per-thread read-receipts; the monitoring-ledger extension and the quarterly officer-oversight export; the guarded two-adult guardian-visibility suspension with the 90-day expiry and the reporter checkpoint; mentor-departure freeze/handoff. Behavioral signals are NOT built (C.6): documented as a scale-triggered future capability with a defined transition threshold.
4. **Surfaces:** the participant send/read + first-open onboarding + report endpoints, the safety-officer reading queue + review endpoints, the guardian read/export/digest endpoints, the director enable/assign/attest endpoints.
5. **Pilot support:** two or three mentors and a small student group for a full cohort, plus a **red-team grooming exercise** (an adult deliberately runs a gradual grooming pattern through synthetic threads using realistic language, not obvious keywords, to prove the flags fire and the officer notices). The purpose is to test the review protocol and the detection, not the code. The go/no-go for real minors is a board, counsel, and insurance decision, not an engineering one.

## Resolved and open
Resolved this round: consent = signed form via the publication upload flow; suspension = two adults (second not a mentor in chapter) + 90-day expiry + reporter checkpoint; attachments = deferred entirely (v1 text-only); oversight = full-coverage reading with read-receipts, not ranked sampling; officer is audited to the board quarterly; mentor-departure and student first-open onboarding added; retention set to the limitations outer bound with encryption at rest.

Open (counsel or program lead): the exact retention age (counsel; placeholder ~30); the weekly-volume threshold that triggers the move from full review to sampling (placeholder to be set); confirmation of the Ohio hotline details and reporter language for the suspension checkpoint.
