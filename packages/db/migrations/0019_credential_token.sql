-- =========================================================================
-- 0019_credential_token.sql — the credential_token store that backs password
-- reset and account recovery. (05-api-surface.md POST /auth/password/
-- reset-request, /reset; 06-onboarding-flows.md Flow D reissueSetup /
-- account.recover — an adult former student gets a fresh setup token to add an
-- email + set a new password.)
--
-- Until now those flows minted tokens into the void: no store, no consume path.
-- This table is that store. A token is minted CSPRNG (packages/runtime/tokens.ts)
-- and ONLY its SHA-256 hash lands here (token_hash) — the plaintext never touches
-- the database, exactly like session.token_hash and invite.token_hash. Validity
-- is evaluated at DECISION TIME against a caller-supplied `now` (expires_at,
-- consumed_at), never by a sweeper, so a token goes invalid the instant it should.
--
-- --- The one-live-per-purpose policy --------------------------------------
-- A regenerate REVOKES the prior: the partial unique index below permits at most
-- ONE live (consumed_at IS NULL) token per (account_id, purpose). The issue path
-- (CredentialTokenService.issuePasswordReset, MaturationService.reissueSetup)
-- supersedes any prior live token for the same (account, purpose) — stamping its
-- consumed_at — before inserting the fresh one, mirroring invite resend and
-- verification_token re-issue. Consumption keys on the globally-unique token_hash,
-- so a hash lookup resolves exactly one row regardless. The two purposes are
-- independent: an account may hold one live password_reset AND one live
-- account_recovery at once.
--
-- --- Guarantees with a red-before-green test (test/credential-token-schema.test.ts)
--   * purpose is an enum; consumed_at defaults null; account_id NOT NULL + FK;
--   * token_hash globally unique;
--   * one live token per (account_id, purpose); a consumed token frees the slot;
--     the two purposes are independent;
--   * Mechanism-A grants: the app role may DML; the analytics read role is
--     denied SELECT (default-deny — this table backs identity recovery, the same
--     stance verification_token takes).
-- CURIOLAB_MIGRATE_UPTO=0018 witnesses the red state (the relation is absent).
-- =========================================================================

-- --- enum (mirror packages/db/src/enums.ts) ------------------------------
CREATE TYPE credential_token_purpose AS ENUM ('password_reset', 'account_recovery');

-- --- credential_token ----------------------------------------------------
CREATE TABLE credential_token (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES account (id),
  token_hash  text NOT NULL,
  purpose     credential_token_purpose NOT NULL,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- The secret is globally unique — consumption resolves exactly one row by hash.
CREATE UNIQUE INDEX credential_token_hash_unique ON credential_token (token_hash);
-- Issue/consume read the live tokens for an account.
CREATE INDEX credential_token_account_idx ON credential_token (account_id);
-- At most one LIVE token per (account, purpose); a consumed token no longer
-- counts, so a regenerate is one supersede (stamp consumed_at) plus one insert.
CREATE UNIQUE INDEX credential_token_one_live_per_purpose
  ON credential_token (account_id, purpose) WHERE consumed_at IS NULL;

-- --- Mechanism A grants (0002) -------------------------------------------
-- The 0002 `GRANT ... ON ALL TABLES` bound only the tables that existed then, so
-- this new table needs its own grant. The application role gets full DML (it
-- issues, consumes, and supersedes); the analytics read role is deliberately NOT
-- granted — a missing grant is the guarantee that an analytics/read login cannot
-- reach the recovery tokens directly, the same default-deny stance
-- verification_token takes, because this table backs identity recovery.
GRANT SELECT, INSERT, UPDATE, DELETE ON credential_token TO curiolab_app;
