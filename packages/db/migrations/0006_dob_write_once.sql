-- =========================================================================
-- 0006_dob_write_once.sql — the DOB-provenance GUARANTEES (02-data-model.md
-- "enrollment_record"; decision-log.md "DOB on the enrollment record, reversed
-- and refined"). Each has a red-before-green test in test/db-guarantees.test.ts;
-- CURIOLAB_MIGRATE_UPTO=0005 witnesses the red state (the column from 0005
-- exists, but these checks and triggers do not).
--
-- Three guarantees, all database-enforced because application code can be
-- bypassed:
--
--   1. A seeding enrollment (student_account_id IS NULL, the brand-new student
--      whose account does not exist yet) MUST carry the form's DOB. A returning
--      student's later-term enrollment already has an account, so it carries no
--      DOB and there is nothing to drift.
--
--   2/3. Both the enrollment record's DOB and the account's DOB are WRITE-ONCE:
--      an ordinary UPDATE that changes either is rejected. Two immutable values
--      copied once (at accept-student) cannot diverge, which is what makes one
--      DOB on the enrollment and one on the account safe.
--
-- The ONLY sanctioned bypass is the explicit, audited `dob.correct` capability
-- (packages/app DobCorrectionService), for the mistyped-scan case. It signals a
-- sanctioned correction with a transaction-local GUC:
--
--     SET LOCAL app.dob_correction = 'on';
--
-- set inside the correcting transaction. The write-once triggers below consult
-- `current_setting('app.dob_correction', true)` (the second argument suppresses
-- the "unrecognized configuration parameter" error, yielding NULL when unset)
-- and permit the change only when it equals 'on'. Because SET LOCAL is scoped to
-- the transaction, no ordinary write path can trip the bypass.
-- =========================================================================

-- 1. Seeding enrollments must carry the DOB; returning ones need not.
ALTER TABLE enrollment_record ADD CONSTRAINT enrollment_dob_required_when_seeding
  CHECK (student_account_id IS NOT NULL OR date_of_birth IS NOT NULL);

-- --- The sanctioned-correction predicate ---------------------------------
-- True only inside a transaction that set app.dob_correction = 'on'.
-- COALESCE so an unset GUC (current_setting(..., true) IS NULL) yields a
-- definite FALSE rather than NULL — otherwise `NOT dob_correction_in_progress()`
-- would be NULL and the write-once IF would silently not fire.
CREATE FUNCTION dob_correction_in_progress() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.dob_correction', true), 'off') = 'on';
$$;

-- 2. enrollment_record.date_of_birth is write-once: once non-null, an UPDATE may
--    not change it to a different value unless a sanctioned correction is in
--    progress. Setting student_account_id (the accept-student linkage backfill)
--    leaves date_of_birth untouched and is unaffected.
CREATE FUNCTION enforce_enrollment_dob_write_once() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.date_of_birth IS NOT NULL
     AND NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth
     AND NOT dob_correction_in_progress() THEN
    RAISE EXCEPTION
      'enrollment_record.date_of_birth is write-once; use the dob.correct capability (record %)',
      OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enrollment_dob_write_once
  BEFORE UPDATE ON enrollment_record
  FOR EACH ROW EXECUTE FUNCTION enforce_enrollment_dob_write_once();

-- 3. account.date_of_birth is write-once: an ordinary UPDATE that changes it is
--    rejected unless a sanctioned correction is in progress. Other account
--    UPDATEs (status, credential_owner, ...) leave the DOB equal and pass.
CREATE FUNCTION enforce_account_dob_write_once() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth
     AND NOT dob_correction_in_progress() THEN
    RAISE EXCEPTION
      'account.date_of_birth is write-once; use the dob.correct capability (account %)',
      OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER account_dob_write_once
  BEFORE UPDATE ON account
  FOR EACH ROW EXECUTE FUNCTION enforce_account_dob_write_once();
