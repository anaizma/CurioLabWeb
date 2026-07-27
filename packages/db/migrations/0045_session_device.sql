-- 0045_session_device.sql — per-session device recognition, so a sign-in from a
-- device the account has never used can be reported to its owner, and so the
-- owner can see and revoke their own live sessions.
--
-- WHAT IS AND IS NOT STORED. The point of these columns is to recognise a
-- returning device, not to profile the person using it, so nothing here is the
-- raw value the browser sent:
--
--   device_hash  a SHA-256 over (account_id, user agent, COARSE client network).
--                Irreversible, and salted by the account id so the same laptop
--                produces a different hash for every account that signs in from
--                it. That kills cross-account correlation, which is the only
--                thing a device fingerprint could otherwise be abused for.
--   device_label a deliberately coarse, human-readable descriptor ("Chrome on
--                Windows"), derived from the user agent and thrown away
--                otherwise. It exists so the sessions list in portal settings
--                reads as something a person recognises. The full user-agent
--                string, which is high-entropy and identifying, is never stored.
--   ip_hint      the client's COARSE network (IPv4 /24, IPv6 /48), never the
--                exact address. Enough for "was this me?" in the new-sign-in
--                email; not enough to place someone at a street address.
--
-- Every column is NULLABLE: sessions minted before this migration, and any
-- caller that arrives with no user agent, simply carry nulls. A null device_hash
-- is treated as "unrecognised", never as a match.
--
-- revoke_token_hash is the one-time token behind the "this wasn't me" link in the
-- new-sign-in email. Only the SHA-256 hash is stored, exactly like session
-- token_hash and credential_token: the raw token is returned once, to the mailer,
-- and never persisted.

ALTER TABLE session
  ADD COLUMN device_hash       text,
  ADD COLUMN device_label      text,
  ADD COLUMN ip_hint           text,
  -- Refreshed (coarsely, not on every request) while the session is in use, so
  -- the sessions list can show "last seen" rather than only "signed in at".
  ADD COLUMN last_seen_at      timestamptz,
  ADD COLUMN revoke_token_hash text;

-- The only read pattern for device_hash: "has THIS account used THIS device
-- before?", asked once per sign-in.
CREATE INDEX session_account_device ON session (account_id, device_hash);

-- The revoke link resolves a token hash to exactly one session. Partial, because
-- the overwhelming majority of sessions never mint a revoke token.
CREATE UNIQUE INDEX session_revoke_token_hash
  ON session (revoke_token_hash)
  WHERE revoke_token_hash IS NOT NULL;

COMMENT ON COLUMN session.device_hash IS
  'SHA-256 over (account_id, user agent, coarse client network). Account-salted, '
  'so the same device is a different hash per account. Used only to answer "has '
  'this account signed in from this device before?".';
COMMENT ON COLUMN session.device_label IS
  'Coarse, human-readable device descriptor for the sessions list (e.g. "Chrome '
  'on Windows"). The raw user-agent string is never stored.';
COMMENT ON COLUMN session.ip_hint IS
  'The client''s coarse network (IPv4 /24, IPv6 /48), never the exact address.';
COMMENT ON COLUMN session.revoke_token_hash IS
  'SHA-256 of the one-time token behind the "this wasn''t me" link in the '
  'new-sign-in email. The raw token is returned once and never persisted.';
