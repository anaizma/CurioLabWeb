-- =========================================================================
-- 0025_mentor_eligibility.sql — mentor eligibility as an append-only STATE
-- ledger (admin/director backend §6, REVIEW-GATED).
--
-- ADDITIVE. A mentor's youth-facing access is contingent on FOUR eligibility
-- components each being CURRENTLY satisfied: background_check (cleared, with a
-- hard expiry), mandatory_reporter_training, cwru_affiliation_verified, and
-- signed_code_of_conduct (versioned). Each clearance is an append-only row per
-- (membership, component), mirroring the consent_grant pattern (0024): a renewal
-- is a NEW row and a lapse is expiry — never a mutation. The current status per
-- (membership, component) is the `mentor_eligibility_current` VIEW: active iff
-- the latest row is non-expired.
--
-- WHY append-only (not one row of four columns): the audit/complaint defense for
-- a youth-safety control is the TRAIL of clearances and renewals with their
-- evidence artifacts, not just the latest values. It also composes with the same
-- reject_append_only_mutation() trigger + role REVOKE that guard consent_grant /
-- access_ledger / audit_entry, so there is one uniform immutability mechanism.
--
-- The ENFORCEMENT this feeds (withdrawing an ineligible mentor's student-facing
-- access via `can`, and the auto-revoke sweep) is behind the app-layer config
-- flag MENTOR_ELIGIBILITY_ENFORCED (default OFF) until legal review — the DB
-- mechanism is built and tested now regardless. Recording clearances never
-- blocks anything; it only WRITES this ledger.
--
-- --- Guarantees with a red-before-green test (test/mentor-eligibility-schema.test.ts)
--   * mentor_eligibility exists; the four-component enum; membership/account fks;
--   * version + evidence_ref optional columns persist;
--   * append-only (UPDATE/DELETE rejected by trigger + REVOKE);
--   * mentor_eligibility_current reflects the latest row per (membership,
--     component), active = non-expired as of now(); a renewal supersedes;
--   * Mechanism-A grants: app SELECT/INSERT (not UPDATE/DELETE); analytics
--     denied SELECT (mentor-adjacent, default-deny).
-- CURIOLAB_MIGRATE_UPTO=0024 witnesses the red state (the relations are absent).
-- =========================================================================

-- --- enum -------------------------------------------------------------------
-- The four eligibility components (§6). Order mirrors core's
-- MENTOR_ELIGIBILITY_COMPONENTS.
CREATE TYPE mentor_eligibility_component AS ENUM (
  'background_check',
  'mandatory_reporter_training',
  'cwru_affiliation_verified',
  'signed_code_of_conduct'
);

-- --- mentor_eligibility (append-only) --------------------------------------
-- One row per clearance EVENT. `cleared_at` is the unifying instant the
-- component was satisfied (cleared / completed / verified / signed); `expires_at`
-- is the renewal clock (background_check always carries one; the others may),
-- null = standing. `version` records the code-of-conduct version; `evidence_ref`
-- is an opaque storage reference (a scan, a training certificate, ...), never
-- file storage here. A renewal is a NEW row with a fresh cleared_at/expires_at.
CREATE TABLE mentor_eligibility (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq           bigserial NOT NULL UNIQUE,
  membership_id uuid NOT NULL REFERENCES membership (id),
  component     mentor_eligibility_component NOT NULL,
  cleared_at    timestamptz NOT NULL DEFAULT now(),
  -- The renewal clock's expiry. Null = standing (no expiry).
  expires_at    timestamptz,
  -- The code-of-conduct version signed (null for the other components).
  version       text,
  -- An opaque storage reference for the clearance artifact.
  evidence_ref  text,
  -- The ops/director account that recorded this clearance (null for a backfill).
  recorded_by   uuid REFERENCES account (id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mentor_eligibility_membership_component_idx
  ON mentor_eligibility (membership_id, component, seq DESC);

-- --- Append-only enforcement (trigger backstop; shares the 0001 function) ---
CREATE TRIGGER mentor_eligibility_append_only
  BEFORE UPDATE OR DELETE ON mentor_eligibility
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

-- --- mentor_eligibility_current (the current-status projection) -------------
-- The latest row per (membership, component) is authoritative; active iff it is
-- non-expired, evaluated at read time against now() (the same decision-time
-- posture as sessions / invites / consent_grant). A VIEW, so it is always correct
-- without a maintenance trigger.
CREATE VIEW mentor_eligibility_current AS
SELECT DISTINCT ON (membership_id, component)
  membership_id,
  component,
  id AS eligibility_id,
  cleared_at,
  expires_at,
  version,
  evidence_ref,
  (expires_at IS NULL OR expires_at > now()) AS active
FROM mentor_eligibility
ORDER BY membership_id, component, seq DESC;

-- --- Mechanism A grants (0002) ---------------------------------------------
-- mentor_eligibility is append-only: the app / rls roles SELECT+INSERT only (the
-- role-level belt to the trigger's braces), mirroring consent_grant /
-- access_ledger. The analytics read role is DENIED SELECT (default-deny — mentor
-- eligibility is a youth-safety control, minor-adjacent, the stance consent /
-- consent_grant take).
GRANT SELECT, INSERT ON mentor_eligibility TO curiolab_app;
GRANT SELECT, INSERT ON mentor_eligibility TO curiolab_rls;
GRANT SELECT ON mentor_eligibility_current TO curiolab_app;
GRANT SELECT ON mentor_eligibility_current TO curiolab_rls;

-- The bigserial `seq` sequence needs its own USAGE grant (0002's ON ALL
-- SEQUENCES bound only the sequences that existed then).
GRANT USAGE, SELECT ON SEQUENCE mentor_eligibility_seq_seq TO curiolab_app, curiolab_rls;
