-- =========================================================================
-- 0009_retention_erase_bypass.sql — the SANCTIONED erase/redaction bypass for
-- the write-once DOB triggers (compliance-coppa.md 1.5 tiered retention, 1.6
-- "the parent's deletion right wins", Part 3 tiered deletion; 02-data-model.md
-- deletion_request).
--
-- 0006 made account.date_of_birth and enrollment_record.date_of_birth
-- write-once, with ONE bypass: a transaction that set app.dob_correction='on'
-- (the audited dob.correct capability, for the mistyped-scan case). Deletion
-- fulfillment needs a DIFFERENT sanctioned reason to change a DOB: to null or
-- tombstone it during an erase/redaction when a parent directs deletion.
--
-- Rather than widen the correction flag (which would let a deletion masquerade
-- as a correction and vice versa, blurring the audit trail), this adds a SECOND
-- transaction-local GUC, distinct in name and purpose:
--
--     SET LOCAL app.retention_erase = 'on';
--
-- set inside the deletion fulfillment transaction (packages/app
-- DeletionFulfillmentService), and ONLY there. Because SET LOCAL is scoped to
-- the transaction, no ordinary write path can trip it, and a correction and an
-- erase remain independently gated: dob.correct never sets retention_erase, and
-- the fulfillment service never sets dob_correction.
--
-- The two write-once trigger functions are replaced (CREATE OR REPLACE; the
-- triggers themselves are unchanged and keep pointing at the same function
-- names) to consult BOTH flags: a DOB change is permitted when a sanctioned
-- correction OR a sanctioned retention erase is in progress.
--
-- 0009 has a red-before-green test in test/retention-erase-bypass.test.ts: with
-- this migration absent, a flagged erase is still blocked by 0006's triggers;
-- an ordinary (unflagged) erase stays blocked throughout, which is the control.
-- =========================================================================

-- The sanctioned-erase predicate. True only inside a transaction that set
-- app.retention_erase = 'on'. COALESCE so an unset GUC (current_setting(...,
-- true) IS NULL) yields a definite FALSE rather than NULL, mirroring
-- dob_correction_in_progress() from 0006.
CREATE FUNCTION retention_erase_in_progress() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.retention_erase', true), 'off') = 'on';
$$;

-- enrollment_record.date_of_birth write-once, now bypassable by a sanctioned
-- correction OR a sanctioned retention erase.
CREATE OR REPLACE FUNCTION enforce_enrollment_dob_write_once() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.date_of_birth IS NOT NULL
     AND NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth
     AND NOT dob_correction_in_progress()
     AND NOT retention_erase_in_progress() THEN
    RAISE EXCEPTION
      'enrollment_record.date_of_birth is write-once; use the dob.correct capability or a retention erase (record %)',
      OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- account.date_of_birth write-once, now bypassable by a sanctioned correction OR
-- a sanctioned retention erase.
CREATE OR REPLACE FUNCTION enforce_account_dob_write_once() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth
     AND NOT dob_correction_in_progress()
     AND NOT retention_erase_in_progress() THEN
    RAISE EXCEPTION
      'account.date_of_birth is write-once; use the dob.correct capability or a retention erase (account %)',
      OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
