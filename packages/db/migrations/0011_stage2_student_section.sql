-- =========================================================================
-- 0011_stage2_student_section.sql — carry the Stage 2B student section on the
-- application (docs/platform/plans/milestone-1-application-funnel.md v2, § 2C).
--
-- The `application` row is minted only at 2C submit (part B, Stage2Service.
-- submitStage2), populated from the 2A parent section (the parent-provided child
-- facts + guardian details, which land in the existing applicant_*/guardian_*
-- columns) AND the 2B student section (the student's own, non-identifying
-- answers). The parent facts fit the existing typed columns; the 2B answers are
-- an open, allowlisted key/value set (Stage2Service enforces the non-identifying
-- allowlist), so they are stored as one jsonb blob on the application here.
--
-- Nullable: only Stage-2-minted applications carry it; every other application
-- (direct ops inserts, reopened successors) leaves it null. No new grant is
-- needed — `application` was already granted to curiolab_app in 0002, and adding
-- a column inherits that. No compliance trigger: the non-identifying guarantee is
-- the application-layer 2B allowlist, enforced before this column is ever written.
-- =========================================================================

ALTER TABLE application ADD COLUMN student_section jsonb;
