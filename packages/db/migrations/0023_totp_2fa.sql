-- =========================================================================
-- 0023_totp_2fa.sql — TOTP two-factor auth, mandatory for privileged first
-- login (admin/director backend §10).
--
-- Adds the per-account TOTP shared secret + activation stamp + replay guard,
-- the one-time backup-code store, the attempt log (rate limiting), and the
-- `totp_pending` credential-token purpose that models the short-lived
-- pending-2FA login state (password proven, second factor not yet supplied — a
-- state that is NOT a full session). Additive: no existing column changes.
--
-- SECRET AT REST: a TOTP secret must be recoverable to verify a code, so unlike
-- password_hash (argon2id) and every *_token (SHA-256), it CANNOT be hashed. It
-- is stored as its base32 string in account.totp_secret. The codebase has no
-- column-encryption seam today; the at-rest expectation (the account table is
-- the trust boundary; add encrypt-on-write/decrypt-on-read in
-- packages/runtime/totp.ts later without touching callers) is documented in the
-- §10 runbook. Backup codes ARE hashed like passwords (argon2id) — they are
-- one-way, so code_hash below stores the hash, never the plaintext.
--
-- --- Guarantees with a red-before-green test (test/totp-schema.test.ts) ------
--   * account.totp_secret / totp_activated_at / totp_last_step exist, nullable;
--   * totp_backup_code: account FK, code_hash NOT NULL, consumed_at nullable;
--     app role may SELECT/INSERT/UPDATE (consume), analytics denied SELECT;
--   * totp_attempt: account FK, success NOT NULL; app SELECT/INSERT;
--   * credential_token_purpose gained 'totp_pending'.
-- CURIOLAB_MIGRATE_UPTO=0022 witnesses the red state (the columns/tables absent).
-- =========================================================================

-- --- credential_token purpose: the short-lived pending-2FA login state -------
-- login mints one after a correct password when the account is privileged; the
-- TOTP submit / enrollment-confirm endpoint consumes it and mints the full
-- session. Independent of the reset purposes' one-live-per-purpose slot (a
-- regenerate on re-login supersedes the prior). Added in its own statement,
-- never referenced in this file's DDL — a freshly added enum value cannot be
-- used in the same transaction it is added in (mirrors 0022's minor_setup).
ALTER TYPE credential_token_purpose ADD VALUE IF NOT EXISTS 'totp_pending';

-- --- account: the TOTP secret + activation + replay guard -----------------
-- totp_secret       the base32 shared secret (null until enrollment begins).
-- totp_activated_at the instant enrollment was CONFIRMED (null = not active; a
--                   secret present but activated_at null = enrollment pending).
-- totp_last_step    the last time-step counter a code was accepted for — the
--                   replay guard: a code from a step <= this is rejected.
ALTER TABLE account
  ADD COLUMN totp_secret       text,
  ADD COLUMN totp_activated_at timestamptz,
  ADD COLUMN totp_last_step    bigint;

-- --- totp_backup_code: the one-time recovery codes ------------------------
-- Shown to the operator ONCE at enrollment confirm; each code_hash is an
-- argon2id hash (hashed like a password — one-way). A code is single-use:
-- consumption stamps consumed_at, so the app role needs UPDATE here (unlike the
-- append-only ledgers). Not append-only.
CREATE TABLE totp_backup_code (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES account (id),
  code_hash   text NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX totp_backup_code_account_idx ON totp_backup_code (account_id) WHERE consumed_at IS NULL;

-- --- totp_attempt: the rate-limit log -------------------------------------
-- One row per second-factor attempt (success flag + timestamp). The service
-- counts recent FAILURES in a rolling window at DECISION TIME and refuses once a
-- cap is exceeded — the same decision-time posture as every other guard here (no
-- sweeper, no stateful lock column). Insert-and-read only.
CREATE TABLE totp_attempt (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES account (id),
  success    boolean NOT NULL,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX totp_attempt_account_at_idx ON totp_attempt (account_id, at);

-- --- Mechanism A grants (0002) -------------------------------------------
-- The 0002 `GRANT ... ON ALL TABLES` bound only tables that existed then, so
-- these new tables need their own grants. The app role gets the DML it needs
-- (backup codes: insert/select/update-to-consume; attempts: insert/select). The
-- analytics read role is deliberately NOT granted — a missing grant is the
-- guarantee an analytics login cannot read 2FA material, the same default-deny
-- stance credential_token / verification_token take (auth material).
GRANT SELECT, INSERT, UPDATE ON totp_backup_code TO curiolab_app;
GRANT SELECT, INSERT ON totp_attempt TO curiolab_app;
