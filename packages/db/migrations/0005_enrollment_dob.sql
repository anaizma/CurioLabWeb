-- =========================================================================
-- 0005_enrollment_dob.sql — structural: the DOB column on the enrollment
-- record (02-data-model.md "enrollment_record"; decision-log.md "DOB on the
-- enrollment record, reversed and refined").
--
-- This is the plain structural floor for the ruled DOB-provenance rework: the
-- nullable column only. The GUARANTEES it enables — the seeding NOT-NULL check
-- and the two write-once triggers with the sanctioned-correction bypass — live
-- in 0006_dob_write_once.sql, mirroring the 0000/0001 and 0003/0004 split so
-- each guarantee has a red-before-green test (CURIOLAB_MIGRATE_UPTO=0005
-- witnesses the red state: the column exists but the checks and triggers do
-- not).
-- =========================================================================

-- enrollment_record.date_of_birth — the form's DOB, living on the seeding
-- enrollment until the student account is created at accept-student. Nullable at
-- the column level; the seeding NOT-NULL rule and write-once discipline are
-- added in 0006. A returning student's later-term enrollment already has an
-- account, so its date_of_birth stays null and there is no second copy to drift.
ALTER TABLE enrollment_record
  ADD COLUMN date_of_birth date;
