# COPPA compliance findings and consent build spec

Grounded in 16 CFR Part 312 as amended (90 FR 16977, Apr. 22, 2025), currently in effect. Section citations throughout so an attorney can check the reasoning rather than re-derive it. Where this document and an earlier spec file disagree on retention, deletion, or consent separability, this document wins and the other file is being corrected to match.

## Part 1: Findings that change the design

### 1.1 Nonprofit status and the Luminent relationship

§ 312.2 defines *operator* and excludes any nonprofit entity that would otherwise be exempt from coverage under Section 5 of the FTC Act. FTC jurisdiction is a functional test, not a tax-status test.

CurioLab is a 501(c)(3) educational program and a customer of Luminent, a for-profit platform vendor. The nonprofit exemption may well apply. The open questions that could complicate it are curriculum licensing to for-profit businesses and how employer sponsorship is framed, both of which an attorney should assess.

Build to full COPPA compliance regardless. It is cheap here because most of it is already built, it removes the exemption question from the critical path, and a future school-district partnership would bring FERPA obligations anyway. Treat the exemption as a defensive argument you may have, not a design assumption you rely on.

### 1.2 The consent method is valid

§ 312.5(b)(2)(i): a consent form signed by the parent and returned by postal mail, facsimile, or electronic scan. That is exactly the flow: the guardian signs, staff upload the scan, the document is the consent record. This is the oldest and most defensible of the eight enumerated methods and survived the amendments unchanged. The Chapter Director name-match against the invite email is a control layered on top, above the floor rather than the floor itself.

### 1.3 Email-plus and text-plus are unavailable

§ 312.5(b)(2)(viii) and (ix) permit email-plus and text-plus only for operators that do not disclose. § 312.2 defines *disclose* to include making a child's personal information publicly available, including public posting. The public project directory and public profiles are disclosure, so those two consent methods are permanently off the table while anything about a child is publicly reachable. The `in_person_witnessed` path is a variant of (b)(2)(i) (the signed form is still the instrument), not a standalone method, and is recorded as such.

### 1.4 Public visibility requires separate consent

§ 312.5(a)(2): the parent must be able to consent to collection and use without consenting to disclosure to third parties, and separate verifiable parental consent is required for that disclosure. The separation of `data_collection` and `platform_participation` from `public_profile`, `photo_media`, and `external_publication` is the rule, not just good design. Two consequences: the consent form must present these as genuinely separable choices with their own signature, and § 312.7 prohibits conditioning participation on more information than reasonably necessary, so participation cannot require `public_profile`. A student who never goes public must be able to complete every tier.

### 1.5 Retention is tiered by data class, not a blanket seven years

§ 312.10 (new in the amendments): retain a child's personal information only as long as reasonably necessary for the specific purpose it was collected for, delete when not, never retain indefinitely, and maintain a written retention policy stating purposes, business need, and a deletion timeframe, published in the online notice. A blanket seven-year rule is not lawful as written. The schedule:

| Class | Retain | Justification |
|---|---|---|
| Verification skeleton: tier, project titles, dates, mentor hours | 7 years | Stated purpose, student-facing benefit, minimal identifiability |
| Enrollment paperwork and signed forms | 7 years | Consent evidence, audit defense |
| Contact details, DOB, guardian details | Active enrollment plus 1 year | No ongoing purpose after that |
| Narrative, feed posts, comments, media | Active enrollment plus 1 year | No verification purpose |
| Audit entries | 7 years, references only, no PII in `detail` | Compliance evidence |

This is the tiered deletion already designed, reused as the routine retention schedule rather than only as a response to a request.

### 1.6 The deletion conflict resolves in the parent's favor

§ 312.6(a)(2) gives the parent, at any time, the right to refuse further use or collection and to direct deletion. § 312.6(c) permits the operator to terminate service to a child whose parent has done so. So the parent's deletion right wins, and ending the child's participation is a permitted consequence. You do not keep a child's data over a parent's objection because verification URLs depend on it. Tell the family plainly that deletion ends participation and ends the verification record. This must be in the consent form.

### 1.7 A written information security program is mandatory

§ 312.8(b) requires a written program with five elements: a designated coordinator, at least annual risk assessments, safeguards against identified risks, regular testing, and at least annual evaluation and modification. For this size it can be a few pages; the coordinator is the founder. § 312.8(c) also requires written assurances (a DPA or equivalent) from every third party that handles children's data before use: the Postgres host, Cloudflare R2, and Resend.

### 1.8 The username design shrinks what is held

§ 312.2 lists a screen or user name as personal information only where it functions like online contact information, meaning it permits direct contact. A CurioLab username that only logs in, cannot be messaged from outside, and is not an email address is arguably not personal information. Protect that deliberately: no direct messaging between accounts, and usernames must not be email-shaped or contactable.

## Part 2: The consent flow as built

No structural change to the designed flow. The changes are in what the form says, what is separable, and what happens on revocation.

### Stage 1: Direct notice at application

§ 312.4(c)(1) is the content spec for the paper form. Every element is mandatory:
1. That CurioLab collected the parent's or child's contact information to obtain consent.
2. That parental consent is required, and nothing is collected, used, or disclosed without it.
3. The specific items of personal information collected, how used, and the potential disclosure opportunities.
4. Where information is disclosed, the identities or categories of recipients including the public where content is made publicly available, the purposes, and a statement that the parent may consent to collection and use without consenting to disclosure.
5. A hyperlink to the full online privacy notice.
6. The means by which the parent gives consent.
7. That if consent is not given within a reasonable time, CurioLab deletes the contact information collected to seek it. This is a real deletion job, not boilerplate.

### Stage 2: The form with separable consent blocks

- **Block A, required to participate:** `enrollment` and `data_collection`. Name, DOB, grade, school, guardian contact, emergency contact, learning records.
- **Block B, optional, participation:** `platform_participation`. The child may sign in, read the internal feed, and post and comment, and will see content and photos other students have shared.
- **Block C, optional, disclosure, separate signature line:** `public_profile` (a link-reachable page showing first name and last initial, tier, project titles), `photo_media` (internal recaps, and separately public materials), `external_publication` (named work public, per-item not blanket).

Block C is the § 312.5(a)(2) separate consent. It is visually and physically separate, with its own signature, and declining it must not affect Block A or B. State plainly that declining Block C costs the student nothing in the program.

### Stage 3: Verification and account creation

Unchanged. Director uploads the scan, invites the guardian at the form's address, matches the name, verifies the edge, backfills `granted_by`, guardian creates the student account. `verification_method` is `signed_form_scan` or `signed_form_in_person`, both mapping to § 312.5(b)(2)(i). `email_plus` and `text_plus` are deliberately absent, commented as unavailable because CurioLab discloses.

### Stage 4: Ongoing rights

§ 312.6 requires a reasonable means for a parent to review, refuse further use, and direct deletion, after verifying the requestor is a parent. The guardian portal satisfies this. Review is the export request; refuse-further-use is revoking `platform_participation` (stops posting and reading immediately) or `data_collection` (effectively withdrawal); delete is honored per the tiered schedule and may terminate participation per § 312.6(c).

## Part 3: What to build and write

### Code changes
1. Consent form content and structure: three blocks, separate signature for Block C, all seven § 312.4(c)(1) elements.
2. Retention schedule by data class per 1.5, as a scheduled job, not only a policy document. Contact details and community content age out at active enrollment plus one year.
3. Deletion fulfillment honors the parent's direction fully, with participation termination as the documented consequence rather than a partial refusal.
4. `verification_method` values map to § 312.5(b)(2)(i); `email_plus` and `text_plus` deliberately absent and commented as unavailable because CurioLab discloses.
5. The § 312.4(c)(1)(vii) deletion job: if consent is not obtained within a set window (proposed: 30 days from contact collection), delete the contact information gathered to seek it.
6. `public_profile` cannot gate participation: enforced as a check that no capability required for tier progression lists it in `actorConsent`.
7. No direct messaging between accounts, to preserve the username-is-not-PII property.

### Configuration, not code
Consent types, form block composition, and retention periods live in configuration (a config table or a constants module), because the mechanism is stable regardless of the legal answer. What flexes is the retention number, whether blocks are separable, and the exact notice text. An unfavorable answer on § 312.10 then becomes a value change, not a migration.

### Documents to write (not code)
1. Written data retention policy, § 312.10, published in the online notice.
2. Written information security program, § 312.8(b), founder named as coordinator, five required elements.
3. Online privacy notice, § 312.4(d), with the required contents including the retention policy and third-party recipient categories.
4. Third-party written assurances, § 312.8(c), from every vendor touching children's data.

### For the attorney (narrowed)
1. Does the § 312.2 nonprofit exclusion apply, given the Luminent licensing relationship and shared founder? Build assuming no; the answer affects posture. This is the material one.
2. Is seven-year retention of the verification skeleton defensible under § 312.10 as reasonably necessary?
3. Confirm § 312.6(c) termination is the right response to a deletion demand, and what notice the family is owed.
4. Ohio requirements for a seventeen-year-old in a paid staff role over younger minors.
5. Whether guardian read access may persist past 18 during the maturation window.
