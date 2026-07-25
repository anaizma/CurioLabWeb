-- =========================================================================
-- 0038_account_school.sql — a first-class, nullable `school` column on account.
-- ADDITIVE.
--
-- The "My Information" self-service surface (GET/PATCH /api/account) makes a
-- student's school an editable field. It graduates from a funnel-only answer
-- (application_draft.parent_answers.schoolName) to a first-class account column so
-- a student can EDIT it after enrollment:
--   - GET returns account.school when set, else FALLS BACK to the student's
--     application_draft.parent_answers.schoolName, so every pre-existing student
--     shows their funnel value with NO data migration;
--   - PATCH (students only) writes account.school.
--
-- It is a plain, nullable free-text column — NOT identity, NOT unique, NOT part
-- of any constraint. Non-students never carry it (the AccountService rejects a
-- non-student school edit; nothing writes it for an adult).
ALTER TABLE account
  ADD COLUMN school text;
