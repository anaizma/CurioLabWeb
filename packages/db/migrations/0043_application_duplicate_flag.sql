-- =========================================================================
-- 0043_application_duplicate_flag.sql — a non-blocking duplicate-applicant flag.
--
-- At submit, if a new application's child name + date of birth matches an
-- existing application in the SAME chapter, it is flagged for the director to
-- review manually (submitStage2). The flag never blocks submission. A director
-- dismisses a false positive via the clear-duplicate-flag ops action, which
-- stamps duplicate_cleared_at/by. "Actively flagged" = flagged_at not null AND
-- cleared_at null. No backfill: the flag applies to new submissions going forward.
-- =========================================================================

ALTER TABLE application ADD COLUMN duplicate_flagged_at timestamptz;
ALTER TABLE application ADD COLUMN duplicate_of_application_id uuid REFERENCES application(id);
ALTER TABLE application ADD COLUMN duplicate_cleared_at timestamptz;
ALTER TABLE application ADD COLUMN duplicate_cleared_by uuid REFERENCES account(id);
