# Form 5: Shareable Verification Link Acknowledgment

**DRAFT FOR ATTORNEY REVIEW. NOT A FINAL FORM. NOT LEGAL ADVICE.**
Document ID: CL-CONSENT-05 · Version 2026.03 (draft) · Governing law: Ohio and applicable federal law
Incorporates Form 00 by reference.

> **Read this first.** CurioLab can create a private web link that shows a summary of your child's verified work, meant to be sent to a specific person such as a teacher or a program. This is not the same as making your child's work public. The important thing to understand is that a link can be forwarded: anyone who has the link can open the page, and anyone you send it to could pass it on. This form is your acknowledgment of that, and it sets the controls we place on the link.

---

## 1. What the link shows

The verification page shows your child's tier, verified projects, chapter, and session count. By default, while your child is under eighteen, it does not show your child's last name, school, or photograph.

## 2. Controls on the link

- The link expires and can be regenerated, which disables the old link.
- The page is set so search engines do not index it.
- CurioLab logs when the link is created and how often it is opened.

## 3. What you acknowledge

- [ ] I understand the link can be forwarded, and anyone holding it can view the page.
- [ ] I understand that regenerating the link disables the old one, and that anyone I previously sent it to will no longer be able to open it.
- [ ] I understand that a link does not make copies unrecoverable: if a viewer saves or screenshots the page, CurioLab cannot retrieve that copy.

## 4. Optional setting

- [ ] Allow the shared page to also include my child's Community posts, in addition to verified work. Leave blank to show verified work only.

## 5. Withdrawing

- [ ] I understand I may disable the link at any time from the guardian portal.

Disabling stops new access through the link. It cannot retrieve copies already made.

## 6. Signature

My signature confirms only the items I checked above.

**Guardian signature:** _________________  **Relationship to child:** ____________  **Date:** ____________

---

### Annex (for CurioLab / counsel)

- **Grant:** `verification_link` (acknowledgment) plus optional `verification_link_community_scope`.
- **Verification:** if the link exposes under-sixteen personal information beyond Internal use, treat as strong VPC; otherwise an access-control acknowledgment subordinate to Form 1. Method follows the data actually exposed.
- **Technical requirements referenced:** token of 128+ bits, hashed at rest, single-purpose, expiry, noindex, access logging.
- **Prohibited:** describing a guessable or non-expiring URL as "private."
- **Authorities:** COPPA Rule (public/third-party release distinct from Internal use); R.C. 1349.09.
