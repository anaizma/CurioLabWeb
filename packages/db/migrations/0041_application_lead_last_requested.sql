-- =========================================================================
-- 0041_application_lead_last_requested.sql — track the most recent time a
-- lead requested its application link.
--
-- A parent who loses the emailed link can re-apply with the same email; each
-- re-request re-mints the Stage-2 token and stamps last_requested_at = now()
-- (LeadService.createLead). The director dashboard's "Date" column reads this
-- as the effective time of an Interested row's current status.
--
-- Backfilled to created_at for existing rows (their only known request time),
-- then defaulted to now() and made NOT NULL so every lead always has one.
-- =========================================================================

ALTER TABLE application_lead ADD COLUMN last_requested_at timestamptz;
UPDATE application_lead SET last_requested_at = created_at WHERE last_requested_at IS NULL;
ALTER TABLE application_lead ALTER COLUMN last_requested_at SET DEFAULT now();
ALTER TABLE application_lead ALTER COLUMN last_requested_at SET NOT NULL;
