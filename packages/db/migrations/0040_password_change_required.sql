-- =========================================================================
-- 0040_password_change_required.sql — a forced-password-change gate.
--
-- account.must_change_password (default false): true means the account holds
-- a temporary/operator-set credential that must be replaced before a session
-- is minted. Set today only by bootstrapPlatformAdmin (§2) — the first
-- platform_admin is seeded with an operator-supplied password out of band, so
-- forcing a change means that operator-known value never becomes the
-- account's standing credential.
--
-- login()/submitTotp()/confirmTotpEnrollment() (packages/http/src/controllers/
-- auth.ts) check this flag BEFORE minting a session and, when set, issue a
-- short-lived 'password_change_required' pending token instead — mirroring
-- the pending-2FA pattern (§10) rather than a new SessionMode. No session
-- exists until the flag is cleared via POST /api/auth/password/change-required.
--
-- credential_token_purpose gains 'password_change_required', following the
-- same ADD VALUE IF NOT EXISTS precedent as 0022 (minor_setup) and 0023
-- (totp_pending) — an independent one-live-per-(account,purpose) slot from
-- password_reset and every other purpose.
-- =========================================================================

ALTER TABLE account ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;

ALTER TYPE credential_token_purpose ADD VALUE IF NOT EXISTS 'password_change_required';
