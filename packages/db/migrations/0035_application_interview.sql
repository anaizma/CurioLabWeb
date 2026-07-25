-- =========================================================================
-- 0035_application_interview.sql — capture the scheduled interview slot on the
-- application (docs/platform/api-reference.md §6 PATCH /api/ops/applications).
--
-- The `scheduleInterview` transition (screening -> interview_scheduled) flipped
-- status and recorded a free-text note, but stored no real interview
-- date/time/location. A director scheduling an interview needs the actual slot
-- so the director portal (and later the applicant-facing notice) can show WHEN
-- and WHERE. Two nullable columns on `application` are sufficient — a single
-- application has at most one live scheduled slot; no separate interview table.
--
--   application
--     interview_at        timestamptz null  -- the scheduled slot (may be set later)
--     interview_location  text null         -- free text (room / video link / address)
--
-- Both are NULLABLE: interviewAt is optional (a director may flip to
-- interview_scheduled first and fill the slot later), so the transition still
-- succeeds with neither field. A reschedule is the same action setting a new
-- time while already interview_scheduled.
--
-- Red-before-green witness (packages/app/test/transitions.test.ts "FIX C"):
--   * scheduleInterview stores interview_at / interview_location and still
--     writes the application_event, in one transaction;
--   * with no fields the transition succeeds and both columns stay null.
--
-- TDD: run with CURIOLAB_MIGRATE_UPTO=0034 to witness those fail (the columns
-- do not exist yet); the default run applies 0035 and they pass.
-- =========================================================================

ALTER TABLE application
  ADD COLUMN interview_at       timestamptz,
  ADD COLUMN interview_location text;
