# Milestone 1 application funnel (v2)

This supersedes v1 in full. v1 modeled Stage 2 as a single staff-converts-the-lead step, which is wrong. The real funnel is a parent-submitted, three-phase Stage 2 against one token, designed so that no verifiable parental consent is required at the application stage because the parent, not the child, is the one who submits. Grounded in [../08-build-phasing.md](../08-build-phasing.md) and [../compliance-coppa.md](../compliance-coppa.md).

## The COPPA logic that shapes it

The application stage collects no personal information from a child and requires no VPC, because of two structural facts: the student section (2B) collects nothing identifying, and only the parent submits (at 2C). That makes the whole thing a parent submission on the minor's behalf, not collection from a child. Both facts are enforced in code, not left to good intentions.

## Stage 1: lead capture (public, no gate, no child data)

`application_lead` is the public write. It carries a parent email, a chapter, and a referral source, and nothing about a child.

- The public write creates one `application_lead` in `new`. No account, no child data. Rate limiting and the bot check are HTTP-layer concerns. Dedupe on `email` within a configurable window.
- Because it holds only a parent email collected to seek consent, an unconverted lead is deleted 30 days after collection (the § 312.4(c)(1)(vii) job). "Unconverted" means no submitted application resulted.

## Stage 2: three phases against one token

A Stage 2 process is one draft bound to the lead, holding partial answers that persist throughout. It advances through three phases:

### 2A: the parent section
The parent fills the parent-provided facts about the child (name, grade, school) and guardian details. Saved against the token. This is parent-provided, so identifying child facts here are fine: the parent is providing them, which is permitted.

### 2B: the student section
The student answers their own section. **2B collects no identifying fields at all: no name, no email, no school.** The 2B link is delivered to the parent's inbox and passed by the parent to the student. **A student email address is never collected anywhere in the system.** 2B **saves and notifies the parent; it does not submit.** The non-identifying constraint is enforced by an allowlist of 2B fields, so an identifying field cannot be saved even if the form is tampered with.

### 2C: parent review and submit
The parent reviews the student's 2B answers **read-only**, with a **send-back** option that returns the draft to 2B for the student to revise. The parent cannot edit the student's answers. **Only the parent can submit, and only at 2C.** Submit is the point where the `application` row is created, populated from the 2A parent section and the 2B student section.

## Invariants to check the implementation against

1. Stage 1 collects only parent email, chapter, referral source. It creates an `application_lead`, never an `application`.
2. Stage 2 is three phases (2A parent, 2B student, 2C parent review-and-submit) against one token, with partial answers persisting throughout.
3. 2B collects no identifying fields (enforced by allowlist); no student email is ever collected.
4. 2B saves and notifies; it does not submit. Only 2C submits, and only the parent.
5. The parent sees 2B read-only at 2C, with send-back, no editing.
6. The `application` row is created at 2C submit, not before.
7. Unconverted leads delete 30 days after collection.

## What this changes in the built code (rework)

1. **Add `application_lead`** (parent email, chapter, referral source, status, token) and **`application_draft`** (bound to the lead: parent token, student token, phase, parent answers, student answers, status), with migrations.
2. **Rework the public write:** the step-1 public `submitApplication` becomes `submitLead` creating an `application_lead`. The full `application` is created only at 2C submit.
3. **Add the Stage 2 service:** start (issue parent token, phase 2A), save the parent section (2A, advance to 2B, issue the student token), save the student section (2B, non-identifying allowlist, save-and-notify, no submit), review (2C read-only view), submit (2C, parent-only, create the `application`), and send-back (2C to 2B).
4. **Rework the retention sweep:** `sweepUnconsentedApplications` becomes `sweepUnconvertedLeads`, deleting unconverted `application_lead` rows (and their drafts) older than the 30-day window, writing the same PII-free `retention.*` audit entry. The child-PII-redaction path over `application` is retired, because the public surface no longer collects child PII.
5. **Update the step-1 and retention tests** to the lead/draft model.

## Live-during-paper-period note

Stage 1 lead capture is the only part of the funnel that may run live during the paper period, because it collects only a parent email. Stage 2 and everything downstream are built and tested against synthetic data now and go live only when the legal review in [../open-questions.md](../open-questions.md) clears.
