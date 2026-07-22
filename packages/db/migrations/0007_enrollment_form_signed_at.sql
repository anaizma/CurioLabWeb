-- =========================================================================
-- 0007_enrollment_form_signed_at.sql — the signature date on the enrollment
-- record (Milestone 1 step 6, part A; 02-data-model.md "enrollment_record",
-- 06-onboarding-flows Flow A step 2 / Flow B step 3).
--
-- The date the guardian signed the paper enrollment/consent form. It is set at
-- coupling D (EnrollmentService), in both the seeding and returning cases, and
-- is the `effective_at` source for the two form-sourced consent rows
-- (`enrollment`, `data_collection`). In the SEEDING case those consents cannot
-- be written at coupling D — the student account does not exist yet — so the
-- signature date must live here until accept-student creates the account and,
-- with it, the ratifying consent rows (InviteService, part B).
--
-- Plain nullable column: a returning enrollment created before this migration,
-- or a legacy seeding one, simply carries null; the value is written going
-- forward by the enrollment upload. No write-once discipline is imposed (unlike
-- date_of_birth): the signature date is not a compliance-canonical value copied
-- across tables, only the temporal anchor for the consents it sources.
-- =========================================================================

ALTER TABLE enrollment_record
  ADD COLUMN form_signed_at date;
