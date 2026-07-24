-- =========================================================================
-- 0022_access_ledger.sql — the append-only invitation/access ledger
-- (admin/director backend §8: the audit/complaint defense).
--
-- A PEER record to audit_entry, not an extension of it. audit_entry is the
-- AUTHORIZATION decision log (permission.denied, capability reads, ops action
-- transitions); its `detail` holds capability/reason references and its shape is
-- tuned for actor+capability+subject decisions. THIS table is the account-
-- ORIGINATION and ACCESS-PROVENANCE record: who invited whom, the token
-- issuance, the redemption (with the client IP), the consent artifact + method
-- referenced at accept-student, membership activation, and mentor-assisted
-- credential resets. It carries columns audit_entry does not (a `client_ip`
-- inet, a target email, an invite kind, a consent-artifact + method reference)
-- and its own read capability, so keeping the two PEERS keeps the audit log's
-- meaning clean (permission decisions) and gives origination provenance its own
-- queryable, IP-bearing, minor-PII-hiding shape. Both are append-only and share
-- the reject_append_only_mutation() trigger + the role-level REVOKE.
--
-- APPEND-ONLY: never mutated; a correction is a NEW row. Enforced by the trigger
-- backstop (blocks even a privileged role) AND the role-level REVOKE (belt).
--
-- PII stance: the ledger stores REFERENCES (ids) plus the origination facts an
-- audit/complaint defense needs — issuer/subject account ids, the target email
-- (already on the invite row), the client IP, and consent-artifact refs. It does
-- NOT store names. Like enrollment_record / guardianship, the analytics read role
-- is DENIED SELECT (default-deny — it touches minor-adjacent origination data).
--
-- --- Guarantees with a red-before-green test (test/access-ledger-schema.test.ts)
--   * the table exists; append-only (UPDATE/DELETE rejected by trigger + REVOKE);
--   * client_ip is inet; event NOT NULL; chapter_id FK; nullable actor/subject;
--   * Mechanism-A grants: the app role may SELECT/INSERT (not UPDATE/DELETE);
--     the analytics role is denied SELECT.
-- CURIOLAB_MIGRATE_UPTO=0021 witnesses the red state (the relation is absent).
-- =========================================================================

-- --- credential_token purpose: the guardian-routed minor setup token (§3/§9) --
-- accept-student mints a one-time setup token bound to the guardian for delivery
-- (NOT emailed to the child); a mentor-assisted recovery mints one in person.
-- A new, independent purpose so it does not collide with the one-live-per-purpose
-- policy of password_reset / account_recovery.
ALTER TYPE credential_token_purpose ADD VALUE IF NOT EXISTS 'minor_setup';

-- --- access_ledger -------------------------------------------------------
CREATE TABLE access_ledger (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at                    timestamptz NOT NULL DEFAULT now(),
  -- The origination/access event: 'invite.issued', 'invite.redeemed',
  -- 'accept_student.consent', 'membership.activated',
  -- 'recovery.guardian_routed', 'recovery.mentor_assisted'.
  event                 text NOT NULL,
  -- Who caused the event (issuer / accepting account / assisting mentor). Null
  -- for a system/job event.
  actor_account_id      uuid REFERENCES account (id),
  real_actor_account_id uuid REFERENCES account (id),
  -- The subject the event concerns (the invited/target student or account).
  subject_account_id    uuid REFERENCES account (id),
  -- The verified guardian a credential/consent is routed through (§3/§9).
  guardian_account_id   uuid REFERENCES account (id),
  chapter_id            uuid REFERENCES chapter (id),
  invite_id             uuid REFERENCES invite (id),
  invite_kind           text,
  -- The email the invite was issued to (already on the invite row; copied here
  -- so the provenance chain is self-contained).
  target_email          citext,
  -- The consent artifact + method referenced at accept-student (§8/§3).
  consent_ref           uuid,
  consent_method        text,
  -- The trusted client IP threaded from the HTTP layer; null for a system event.
  client_ip             inet,
  -- References only, never PII (names/narratives/contact) — like audit_entry.
  detail                jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX access_ledger_chapter_at_idx ON access_ledger (chapter_id, at);
CREATE INDEX access_ledger_subject_at_idx ON access_ledger (subject_account_id, at);
CREATE INDEX access_ledger_invite_idx ON access_ledger (invite_id);

-- --- Append-only enforcement (trigger backstop; shares the 0001 function) ---
CREATE TRIGGER access_ledger_append_only
  BEFORE UPDATE OR DELETE ON access_ledger
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

-- --- Mechanism A grants (0002) -------------------------------------------
-- The application role may SELECT/INSERT only (append-only: UPDATE/DELETE are
-- REVOKEd, the belt to the trigger's braces, exactly as consent/audit_entry).
-- The RLS role likewise inserts+reads but cannot mutate. The analytics read role
-- is deliberately NOT granted SELECT — default-deny, the same stance
-- enrollment_record / guardianship take, because this table is origination data.
GRANT SELECT, INSERT ON access_ledger TO curiolab_app;
GRANT SELECT, INSERT ON access_ledger TO curiolab_rls;
