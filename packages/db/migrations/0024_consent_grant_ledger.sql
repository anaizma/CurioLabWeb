-- =========================================================================
-- 0024_consent_grant_ledger.sql — consent as an append-only GRANT ledger
-- (admin/director backend §5, revised 2026-07-24).
--
-- ADDITIVE. This does NOT touch the existing `consent` / `consent_current`
-- tables (the 3 blocks + §312.7, load-bearing for membership activation and
-- accept-student). It adds a PARALLEL, per-practice grant ledger: six
-- independent grant types, each captured in one guardian sitting but its own
-- append-only row so it can expire, renew, and be revoked on its own clock
-- (COPPA requires consent specific to each practice and independently revocable).
--
-- A revocation or a renewal is a NEW row, never a mutation — enforced by the
-- same reject_append_only_mutation() trigger + role-level REVOKE that guard
-- access_ledger / consent / audit_entry. The current status per (subject,
-- grant_type) is the `consent_grant_current` VIEW: active iff the latest row is
-- non-revoked AND non-expired.
--
-- The whole public-publication surface this enables (the publish gate, the
-- notify-and-object window) stays behind a config flag that defaults OFF
-- (CONSENT_GRANT_LEDGER_ENFORCED) until the legal review — the DB mechanism is
-- built and tested now regardless.
--
-- --- Guarantees with a red-before-green test (test/consent-grant-schema.test.ts)
--   * consent_grant exists; the six grant-type + five method enums; subject/
--     guardian fks; append-only (UPDATE/DELETE rejected by trigger + REVOKE);
--   * the under-13 public_publication strong-method DB floor (a click, or a
--     missing evidence artifact, for a subject under 13 is REFUSED; a strong
--     method + artifact is accepted; 13+ click accepted; a revocation row is
--     exempt);
--   * consent_grant_current reflects the latest grant per (subject, type), with
--     active = non-revoked AND non-expired;
--   * publication_hold exists and is UPDATEable (object/release), not append-only;
--   * Mechanism-A grants: app SELECT/INSERT consent_grant (not UPDATE/DELETE),
--     SELECT/INSERT/UPDATE publication_hold; analytics denied SELECT on both.
-- CURIOLAB_MIGRATE_UPTO=0023 witnesses the red state (the relations are absent).
-- =========================================================================

-- --- enums -----------------------------------------------------------------
-- The six independent grant types (§5 detail table). Each is captured, expires,
-- renews, and revokes on its own clock.
CREATE TYPE consent_grant_type AS ENUM (
  'program_participation',
  'platform_account',
  'public_publication',
  'photo_video_likeness',
  'emergency_medical_pickup',
  'verification_link_sharing'
);

-- The capture methods: the FTC-approved strong methods for verifiable parental
-- consent, plus the portal `click` (email-plus, permitted only when NOT publicly
-- disclosing — see the under-13 public_publication floor below).
CREATE TYPE consent_grant_method AS ENUM (
  'click',
  'signed_form',
  'monetary_transaction',
  'video_call',
  'id_verification'
);

-- --- consent_grant (append-only) ------------------------------------------
-- One row per grant EVENT. A fresh grant carries revoked_at null and an
-- expires_at per the renewal clock; a revocation or a lapse is a NEW row with
-- revoked_at set; a renewal is a NEW grant row with a fresh expires_at. The row
-- shape is the §5 grant record: grant_type, subject, guardian, scope, method,
-- granted_at, evidence_artifact_ref, expires_at, revoked_at|null, revoked_by|null.
CREATE TABLE consent_grant (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq                        bigserial NOT NULL UNIQUE,
  grant_type                 consent_grant_type NOT NULL,
  subject_student_account_id uuid NOT NULL REFERENCES account (id),
  -- The verified guardian who captured the grant. Null for a self-grant (the
  -- 18th-birthday re-confirmation) or a system-written lapse.
  guardian_account_id        uuid REFERENCES account (id),
  -- An optional descriptive scope (e.g. a term ref); the practice is the
  -- grant_type, so most grants leave this null.
  scope                      text,
  method                     consent_grant_method NOT NULL,
  granted_at                 timestamptz NOT NULL DEFAULT now(),
  -- An opaque storage reference the frontend/ops supplies for a strong-method
  -- artifact (a signed form scan, a $1-auth receipt, ...). Never file storage here.
  evidence_artifact_ref      text,
  -- The renewal clock's expiry (per-term / annual / standing). Null = standing.
  expires_at                 timestamptz,
  revoked_at                 timestamptz,
  revoked_by                 uuid REFERENCES account (id),
  created_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX consent_grant_subject_type_idx
  ON consent_grant (subject_student_account_id, grant_type, seq DESC);

-- --- The under-13 public_publication strong-method floor -------------------
-- A portal checkbox ("email-plus") is COPPA-acceptable only when NOT publicly
-- disclosing; a public_publication grant IS public disclosure. So for a subject
-- UNDER 13 it requires an FTC-approved STRONG method (signed_form /
-- monetary_transaction / video_call / id_verification) AND a non-null
-- evidence_artifact_ref. A `click`, or a strong method with no artifact, is
-- REFUSED. For 13+ a click is accepted. Age is computed from the subject's DOB
-- at granted_at. The floor applies to GRANT rows only (revoked_at null); a
-- revocation event is exempt. A database floor, not application code, because
-- application code can be bypassed.
CREATE FUNCTION enforce_under13_public_publication_strong_method() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE dob date;
BEGIN
  IF NEW.grant_type = 'public_publication' AND NEW.revoked_at IS NULL THEN
    SELECT date_of_birth INTO dob FROM account WHERE id = NEW.subject_student_account_id;
    -- under 13 iff born strictly after (granted_at - 13 years)
    IF dob > (NEW.granted_at::date - INTERVAL '13 years') THEN
      IF NEW.method = 'click' THEN
        RAISE EXCEPTION
          'public_publication for a subject under 13 requires a strong verification method, not a click (subject %)',
          NEW.subject_student_account_id
          USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.evidence_artifact_ref IS NULL THEN
        RAISE EXCEPTION
          'public_publication for a subject under 13 requires a non-null evidence artifact reference (subject %)',
          NEW.subject_student_account_id
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER consent_grant_under13_strong_method
  BEFORE INSERT ON consent_grant
  FOR EACH ROW EXECUTE FUNCTION enforce_under13_public_publication_strong_method();

-- --- Append-only enforcement (trigger backstop; shares the 0001 function) ---
CREATE TRIGGER consent_grant_append_only
  BEFORE UPDATE OR DELETE ON consent_grant
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

-- --- consent_grant_current (the current-status projection) -----------------
-- The latest row per (subject, grant_type) is authoritative; active iff it is
-- non-revoked AND non-expired (evaluated at read time against now(), the same
-- decision-time posture as sessions / invites / time-boxing). A VIEW, so it is
-- always correct without a maintenance trigger.
CREATE VIEW consent_grant_current AS
SELECT DISTINCT ON (subject_student_account_id, grant_type)
  subject_student_account_id,
  grant_type,
  id AS grant_id,
  guardian_account_id,
  scope,
  method,
  granted_at,
  evidence_artifact_ref,
  expires_at,
  revoked_at,
  revoked_by,
  (revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())) AS active
FROM consent_grant
ORDER BY subject_student_account_id, grant_type, seq DESC;

-- --- publication_hold (the notify-and-object window) -----------------------
-- Standing publication is NOT blanket pre-approval. When an item is nominated
-- for a public surface, a hold is recorded (item ref, subject, nominated_at,
-- the notified guardian, releases_at = nominated_at + N days). The
-- runPublicationHolds job publishes an un-objected hold once its window elapses
-- and withholds an objected one. UPDATEable (object stamps objected_at, release
-- stamps released_at), so NOT append-only.
CREATE TABLE publication_hold (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type                  text NOT NULL,
  item_ref                   text NOT NULL,
  subject_student_account_id uuid NOT NULL REFERENCES account (id),
  -- The guardian notified when the hold opened (null if unresolved at nominate).
  guardian_account_id        uuid REFERENCES account (id),
  nominated_at               timestamptz NOT NULL DEFAULT now(),
  releases_at                timestamptz NOT NULL,
  objected_at                timestamptz,
  objected_by                uuid REFERENCES account (id),
  released_at                timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now()
);

-- The job scans open holds whose window has elapsed: not objected, not released.
CREATE INDEX publication_hold_open_idx
  ON publication_hold (releases_at)
  WHERE objected_at IS NULL AND released_at IS NULL;
CREATE INDEX publication_hold_subject_idx
  ON publication_hold (subject_student_account_id);

-- --- Mechanism A grants (0002) -------------------------------------------
-- consent_grant is append-only: the app / rls roles SELECT+INSERT only (the
-- role-level belt to the trigger's braces), mirroring consent / access_ledger.
-- publication_hold is a mutable work table: SELECT+INSERT+UPDATE. The analytics
-- read role is DENIED SELECT on BOTH (default-deny — grant status and the hold
-- queue are minor-adjacent, the stance enrollment_record / consent take).
GRANT SELECT, INSERT ON consent_grant TO curiolab_app;
GRANT SELECT, INSERT ON consent_grant TO curiolab_rls;
GRANT SELECT ON consent_grant_current TO curiolab_app;
GRANT SELECT ON consent_grant_current TO curiolab_rls;
GRANT SELECT, INSERT, UPDATE ON publication_hold TO curiolab_app;
GRANT SELECT, INSERT, UPDATE ON publication_hold TO curiolab_rls;

-- The bigserial `seq` sequence needs its own USAGE grant (0002's ON ALL
-- SEQUENCES bound only the sequences that existed then).
GRANT USAGE, SELECT ON SEQUENCE consent_grant_seq_seq TO curiolab_app, curiolab_rls;
