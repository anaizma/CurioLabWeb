-- =========================================================================
-- 0003_consent_enrollment_link.sql — structural: the enrollment anchor column
-- on consent (02-data-model.md, the ruled consent change).
--
-- This mirrors the 0000-then-0001 split: the plain column and FK live here;
-- the GUARANTEE it enables (the signed_form binding check and the replaced
-- temporal trigger) lives in 0004_consent_temporal_rule.sql, so each guarantee
-- has a red-before-green test (CURIOLAB_MIGRATE_UPTO=0003 witnesses the red
-- state: the column exists but the checks do not).
-- =========================================================================

-- consent.enrollment_record_id — the temporal anchor for a form-sourced grant.
-- Nullable at the column level; a signed_form row with a null value is rejected
-- by the CHECK added in 0004. Digital grants leave it null.
ALTER TABLE consent
  ADD COLUMN enrollment_record_id uuid REFERENCES enrollment_record (id);
