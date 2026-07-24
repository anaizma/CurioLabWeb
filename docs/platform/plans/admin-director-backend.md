# Admin/Director portal + invite-origination + youth-safety: backend execution plan

Tracks the 12-item work order (2026-07-24) for the Admin/Director portals, the invite/account-origination system, and youth-safety controls. Coordination branch `feat/platform-m1`; backend stages only `packages/` + `docs/`, frontend stages only frontend files. The governing invariant: **no self-signup — every account originates from an invite tied to a roster entry created by someone with authority.**

Phases in priority order (front-loaded to unblock the frontend). Each is test-first, verified with the full suite AND a clean `npm run build`, committed, and pushed; the frontend is pinged when a phase lands.

| Phase | Items | What it unblocks | Status |
|---|---|---|---|
| **P1** | §11 director read endpoints (~10 chapter-scoped GET lists/detail + optional dashboard) | the whole director portal flips from fallback to live | in progress |
| **P2** | §1 invite kinds (`director`/`admin`) + per-kind authority + two-person director approval; §4 token hardening (email-binding on redeem, per-kind expiries 72h/7d); §12 confirm issue returns `{inviteId, token, expiresAt}` | the Invites page (director sees guardian/mentor/staff + director-two-person; admin sees all) | pending |
| **P3** | §3 guardian-before-student enforcement (accept-student requires a VERIFIED guardianship + consent on file); §8 append-only invitation/access ledger; §9 minor recovery (guardian-routed + logged mentor-assisted path) | the safety/ordering invariant + audit-defense ledger | pending |
| **P4** | §10 TOTP support + mandatory for admin/director/mentor first login; §2 guarded admin bootstrap seed (idempotent, refuses once an admin exists, enrolls TOTP) | first-account origination + 2FA | pending |
| **P5** | §7 time-boxing (confirm/enforce term-end expiry + lapsed auto-revoke — mostly exists via decision-time expiry) | former-volunteer access closes automatically | done — decision-time expiry confirmed (`can`/`inForce`); added `runTimeBoxSweep` job body (active→inactive at term end, clears pod links, system-actor audit + access-ledger, idempotent). No migration/route/capability needed. See BUILD-STATUS §P5 |
| **P6 (REVIEW-GATED)** | §5 consent as an append-only grant ledger (six independent grant types, strong verification for under-13 public disclosure, notify-and-object window, 18th-birthday transfer, per-grant revocation cascades) — see §5 detail below; §6 mentor eligibility as state (background_check with cleared-date+expiry, mandatory-reporter-training, CWRU-affiliation, code-of-conduct; gate student-facing access) | build the mechanism now; do NOT flip on public-publication capture (especially the under-13 strong-method path) for production data until the legal review | pending |

## Notes
- §12: invite emails are sent by the frontend via Resend; the backend keeps returning `{ inviteId, token, expiresAt }` from issue/resend. No backend mailer for invites.
- Anti-patterns rejected outright: shared chapter passwords, sequential/short codes, plaintext initial passwords in email, non-expiring links, mentors creating student accounts directly.
- P6 mechanisms are built and tested but stay gated behind the legal review before any real family's data flows (consistent with the whole platform's synthetic-data-only posture).
- Coordination: ping the frontend when P1 shapes and the P2 invite kinds land; each surface flips in one edit.

## §5 detail (revised 2026-07-24) — Consent as an append-only grant ledger

Supersedes the earlier two-tier (email-plus vs strong VPC) split, which was too coarse. Consent is stored as a set of independent, append-only grant records, never one bundled "I agree." Each grant is captured in the guardian's one sitting but is its own row so it can expire, renew, and be revoked on its own clock. Three reasons: COPPA requires consent specific to each practice and independently revocable; these grants expire on different clocks (temporal); and per-grant records are stronger evidence than "they signed the packet."

**Grant record shape (every grant):** `{ grantType, subjectStudentAccountId, guardianAccountId, scope, method, grantedAt, evidenceArtifactRef, expiresAt, revokedAt|null, revokedBy|null }`. Append-only: a revocation or renewal is a new row, never a mutation.

**The six grant types:**

| grantType | Renewal clock | Revocable alone | Capture method |
|---|---|---|---|
| `program_participation` | per cohort/term | No — revoking ends enrollment | click |
| `platform_account` (internal posting) | per cohort/term | Yes | click |
| `public_publication` (newsletter, community, public profile) | annual | Yes | strong method (see below) |
| `photo_video_likeness` | annual | Yes | click (or strong if bundled with publication) |
| `emergency_medical_pickup` | per cohort/term | No — required for participation | click |
| `verification_link_sharing` | standing | Yes | click |

**Rules to enforce:**
1. **Publishing gates on the specific grant.** Narrative publish, project `public_listed`, and newsletter inclusion require a current (non-expired, non-revoked) `public_publication` grant for that student. General/internal access requires only `platform_account`. No other grant substitutes.
2. **Strong verification for `public_publication` when the subject is under 13.** A portal checkbox is "email-plus," which COPPA permits only when NOT publicly disclosing; this grant is public disclosure. So for a subject under 13, `public_publication` requires an FTC-approved strong method: uploaded signed form (mail/fax/scan), a monetary-transaction verification (e.g. a $1 card auth), a video call, or ID/knowledge-based verification. Record which in `method` and the artifact in `evidenceArtifactRef`. Every other grant is a click. For 13+, portal capture is acceptable.
3. **Standing publication is not blanket pre-approval — notify-and-object window.** A `public_publication` grant does not auto-publish future work. When a post/project is nominated for a public surface, fire a guardian email notification and start a hold timer; it publishes only if the guardian does not object within N days (configurable, default 5). Objection withholds that specific item without touching the grant.
4. **18th-birthday transfer is its own event.** When a student turns 18, consent authority transfers to them: existing guardian grants lapse and the now-adult student must re-confirm the ones that persist (publication, likeness, verification-link). Record the transfer and each re-confirmation as new grant rows. Hook this into the existing maturation flow.
5. **Per-grant revocation endpoints.** A guardian can revoke any single revocable grant without affecting the others or ending participation. Revoking `public_publication` also unpublishes/withholds that student's currently-public items (cascade), consistent with the existing safeguard-suspend behavior.

**Guardian-portal reads (add to the read-endpoints coordination):** the guardian's children; per-child the six grants with status/expiry/method/artifact; and per-child the list of that child's publicly-visible posts/projects (public surface only, never drafts or private messages) for a read-only child-visibility panel. Frontend renders the mixed click-vs-signed-form checklist and the visibility panel; backend owns grant capture, strong-verification artifact intake, the notify-and-object timer, and the cascades.

**§8 ledger addition:** the invitation/access ledger must also record every grant, renewal, revocation, notify-and-object notification + outcome, and 18th-birthday transfer, each with method and artifact reference. That record is the audit/complaint defense.
