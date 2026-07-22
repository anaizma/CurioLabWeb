# Paper period operations (fall 2026)

The fall 2026 cohort runs without the platform. This document is the manual process and the paper artifacts, designed so a later import is transcription rather than archaeology, and so the same guarantees the software will enforce are honored by hand in the meantime. It maps onto the schema per the table in [06-onboarding-flows.md](06-onboarding-flows.md).

This is the only deliverable in the plan with a deadline that has not moved.

## The guarantees, honored by hand

The software exists to make these automatic. Until it does, a person is responsible for each. The Chapter Director owns all of them unless noted.

1. **No child's information is collected before consent exists.** The signed enrollment and consent form is collected first, in full, before any roster entry, photo, or record is created for that student. If there is no signed form, there is no student.
2. **Date of birth comes only from the signed form.** It is written on the roster from the form and never re-keyed from any other source. If a discrepancy appears, the form wins and the discrepancy is noted.
3. **The guardian is verified by name match.** The person who signs and returns the form is checked against a photo ID or a known-parent relationship at the interview. The Director records that they did this and against what.
4. **The guardian email on the form is the address of record.** All future contact and the eventual platform invite go to that address. Changing it requires a new signed form. Do not accept a verbal or emailed change.
5. **Consent is per type and revocable.** The form captures each consent type separately. A revocation is recorded as a new dated line in the revocation log, never by erasing the original grant.
6. **A safety concern is escalated immediately.** Any disclosure of harm or a safeguarding concern goes to the Chapter Director the same day, and to the national contact if the Director is unreachable, exactly as the platform would escalate a `class = safety` report.

## Folder discipline (import-ready)

One folder per student, named `LASTNAME_FIRSTNAME_CHAPTER_TERM` (for example `SONG_E_CWRU_FA2026`). Inside each, these exact filenames, so the import job can find them without guessing:

```
LASTNAME_FIRSTNAME_CHAPTER_TERM/
  application.pdf              scan of the application form
  enrollment-consent.pdf       scan of the SIGNED enrollment and consent form (the COPPA floor)
  guardian-id.pdf              the identity check used for the name match, if a document was used
  interview-notes.txt          decision, date, and any reopen history
  media-consent-log.txt        any photo consent changes, dated
  revocation-log.txt           any consent revocation, dated, one line each
```

The signed `enrollment-consent.pdf` is the single most important artifact in the system. It is the `dob_source_ref` and the guardianship `source_ref`. Store the folders in an access-controlled location (not a shared open drive), encrypted at rest, with access limited to the Director and the founder. Do not email these files. A scan appearing in an inbox or an open drive is a data incident, not a convenience.

University-role applicants get a folder too: `LASTNAME_FIRSTNAME_CHAPTER_TERM_ROLE/` with `application.pdf`, `interview-notes.txt`, and the track and GitHub link in the notes. No guardian or consent artifacts.

## The paper forms

### Student application form (public)

Collects only what the `application` row needs. Keep it plain.

- Applicant first and last name
- Grade (must be 6 through 12)
- School
- Applicant contact email (may be the guardian's)
- Guardian first and last name
- Guardian email (this becomes the address of record)
- Guardian phone
- A short interest prompt
- Guardian signature and date acknowledging the application

### University-role application form (public)

- Applicant first and last name
- University and year
- Track applied for (teaching, operations, or technical)
- GitHub or portfolio link
- Contact email

### Enrollment and consent form (the signed COPPA floor)

This is the form that must be signed and returned before anything is created for the student. It carries, in this order:

- Student legal first and last name
- Student date of birth (the authoritative source)
- Chapter and term
- Guardian legal first and last name
- Guardian email (must match the application; if different, this is the new address of record and supersedes it)
- Guardian phone and mailing address

Then a separate, individually checked and initialed consent for each type, so consent is recorded per axis exactly as the schema stores it:

- [ ] **Enrollment.** My child may enroll and hold a membership in this chapter for this term.
- [ ] **Data collection.** CurioLab may keep an operational record about my child (tier, projects, mentor hours, timeline).
- [ ] **Platform participation.** My child may access the internal community, including reading and posting, and may see content and photos other students have shared. (Note on the form that this covers reading, not only posting.)
- [ ] **Public profile.** My child's profile may be reachable through a private verification link I or my child choose to share.
- [ ] **Photo and media.** My child may appear in images others post within the program.
- [ ] **External publication.** (Left blank at enrollment. Collected later, per named project or newsletter issue, because it is never blanket.)

Finally: guardian signature and date. The signature date is the consent `effective_at` at import.

Include on the form, in plain language, the parent's rights: to review what has been collected about their child, to request a copy, and to request deletion, with the chapter contact for doing so. This is what the guardian portal will later serve, and the paper period must offer it too.

## The tracking spreadsheet (the interim roster)

One row per student, columns in an order that maps straight to import:

`student_last, student_first, dob, grade, chapter, term, guardian_last, guardian_first, guardian_email, guardian_verified_by, guardian_verified_how, application_status, consent_enrollment, consent_data, consent_participation, consent_public_profile, consent_photo, membership_status, tier, pod, folder_name, notes`

The `consent_*` columns hold the signature date when granted and are left blank when not, matching the per-type model. `application_status` uses the same values as the `application` machine (`submitted`, `screening`, `interview_scheduled`, `accepted`, `enrolled`, `declined`, `withdrawn`), so status history and reopens transcribe directly. `guardian_verified_how` records the name-match method (photo ID, known parent at interview), which becomes `verification_method` at import.

Keep the spreadsheet in the same access-controlled location as the folders. It contains children's names and dates of birth and is not a document to share or email.

## The import, later

When Milestone 1 is ready, the founder runs a one-time, audited import that reads the spreadsheet and the folders and creates `application`, `enrollment_record`, `guardianship` (as `pending`, to be verified in-platform), the form-sourced `consent` rows, and `membership` rows, writing an audit entry per record. It is not a contributor task. Because the folder names and filenames are fixed and the spreadsheet columns map one to one, the import is transcription. That is the entire reason for the discipline above.
