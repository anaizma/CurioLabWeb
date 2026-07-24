# Admin/Director portal + invite-origination + youth-safety: backend execution plan

Tracks the 12-item work order (2026-07-24) for the Admin/Director portals, the invite/account-origination system, and youth-safety controls. Coordination branch `feat/platform-m1`; backend stages only `packages/` + `docs/`, frontend stages only frontend files. The governing invariant: **no self-signup — every account originates from an invite tied to a roster entry created by someone with authority.**

Phases in priority order (front-loaded to unblock the frontend). Each is test-first, verified with the full suite AND a clean `npm run build`, committed, and pushed; the frontend is pinged when a phase lands.

| Phase | Items | What it unblocks | Status |
|---|---|---|---|
| **P1** | §11 director read endpoints (~10 chapter-scoped GET lists/detail + optional dashboard) | the whole director portal flips from fallback to live | in progress |
| **P2** | §1 invite kinds (`director`/`admin`) + per-kind authority + two-person director approval; §4 token hardening (email-binding on redeem, per-kind expiries 72h/7d); §12 confirm issue returns `{inviteId, token, expiresAt}` | the Invites page (director sees guardian/mentor/staff + director-two-person; admin sees all) | pending |
| **P3** | §3 guardian-before-student enforcement (accept-student requires a VERIFIED guardianship + consent on file); §8 append-only invitation/access ledger; §9 minor recovery (guardian-routed + logged mentor-assisted path) | the safety/ordering invariant + audit-defense ledger | pending |
| **P4** | §10 TOTP support + mandatory for admin/director/mentor first login; §2 guarded admin bootstrap seed (idempotent, refuses once an admin exists, enrolls TOTP) | first-account origination + 2FA | pending |
| **P5** | §7 time-boxing (confirm/enforce term-end expiry + lapsed auto-revoke — mostly exists via decision-time expiry) | former-volunteer access closes automatically | pending |
| **P6 (REVIEW-GATED)** | §5 two-tier consent (general email-plus vs strong VPC for public disclosure; gate publish/public_listed/newsletter on the strong artifact + record capture method); §6 mentor eligibility as state (background_check with cleared-date+expiry, mandatory-reporter-training, CWRU-affiliation, code-of-conduct; gate student-facing access) | build the mechanism now; do NOT flip on for production data until the legal review | pending |

## Notes
- §12: invite emails are sent by the frontend via Resend; the backend keeps returning `{ inviteId, token, expiresAt }` from issue/resend. No backend mailer for invites.
- Anti-patterns rejected outright: shared chapter passwords, sequential/short codes, plaintext initial passwords in email, non-expiring links, mentors creating student accounts directly.
- P6 mechanisms are built and tested but stay gated behind the legal review before any real family's data flows (consistent with the whole platform's synthetic-data-only posture).
- Coordination: ping the frontend when P1 shapes and the P2 invite kinds land; each surface flips in one edit.
