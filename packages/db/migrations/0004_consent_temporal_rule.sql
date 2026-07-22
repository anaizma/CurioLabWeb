-- =========================================================================
-- 0004_consent_temporal_rule.sql — the ruled consent change (02-data-model.md
-- "Consent"; compliance-coppa.md Part 2). Two guarantees, each with a
-- red-before-green test in test/db-guarantees.test.ts:
--
--   1. A signed_form consent must name the enrollment record it was captured
--      under (the temporal anchor). A signed_form row with a null
--      enrollment_record_id is invalid.
--
--   2. effective_at (the guardian's signature instant) may not be in the
--      future, and — when an enrollment record is named — may not precede the
--      SUBMISSION DATE of the linked application, reached through
--      enrollment_record.application_id -> application.created_at, NOT the
--      enrollment record's own created_at. A guardian legitimately signs the
--      form before staff upload the scan, so the enrollment record's creation
--      is the wrong floor; the application submission is the earliest
--      meaningful anchor (a guardian cannot sign consent for a program not yet
--      applied to). This REPLACES the future-only trigger from 0001.
-- =========================================================================

-- 1. signed_form rows must carry their enrollment anchor.
ALTER TABLE consent ADD CONSTRAINT consent_signed_form_enrollment_ref
  CHECK (NOT (source = 'signed_form' AND enrollment_record_id IS NULL));

-- 2. Replace the temporal trigger: future check (retained) + submission floor.
DROP TRIGGER consent_effective_not_future ON consent;
DROP FUNCTION enforce_consent_effective_not_future();

CREATE FUNCTION enforce_consent_effective_temporal() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE submitted_at timestamptz;
BEGIN
  -- (a) never in the future: the guardian's decision instant is real, not post-dated.
  IF NEW.effective_at > now() THEN
    RAISE EXCEPTION 'consent effective_at may not be in the future (%)', NEW.effective_at
      USING ERRCODE = 'check_violation';
  END IF;

  -- (b) when anchored to an enrollment record, never before the application was
  -- submitted. The floor is application.created_at (the submission instant),
  -- reached through enrollment_record.application_id — deliberately NOT the
  -- enrollment record's own created_at, which a legitimate pre-upload signature
  -- precedes.
  IF NEW.enrollment_record_id IS NOT NULL THEN
    SELECT a.created_at INTO submitted_at
      FROM enrollment_record e
      JOIN application a ON a.id = e.application_id
      WHERE e.id = NEW.enrollment_record_id;
    IF submitted_at IS NOT NULL AND NEW.effective_at < submitted_at THEN
      RAISE EXCEPTION
        'consent effective_at (%) may not precede the application submission date (%)',
        NEW.effective_at, submitted_at
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
CREATE TRIGGER consent_effective_temporal
  BEFORE INSERT ON consent
  FOR EACH ROW EXECUTE FUNCTION enforce_consent_effective_temporal();
