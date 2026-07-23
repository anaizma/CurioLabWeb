-- =========================================================================
-- 0010_application_funnel.sql — the Milestone 1 v2 application-funnel rework
-- (docs/platform/plans/milestone-1-application-funnel.md; compliance-coppa.md).
--
-- The public funnel is no longer a single staff-converts-the-lead step. Stage 1
-- is a public parent-email lead capture (`application_lead`) that creates no
-- account and no `application`; Stage 2 is a parent-submitted three-phase draft
-- (`application_draft`) bound to one token, and the `application` row is created
-- only at 2C submit. This migration adds the two tables and their enums.
--
--   application_lead   — Stage 1. Holds ONLY a parent email, a chapter, and a
--                        referral source. No child data. An unconverted lead is
--                        deleted 30 days after collection (§ 312.4(c)(1)(vii)),
--                        the sweepUnconvertedLeads job (packages/app).
--   application_draft  — Stage 2 persistence, POPULATED BY PART B (the 2A/2B/2C
--                        flow). Created here as the table only: bound to a lead,
--                        carrying the parent/student tokens, the phase, the
--                        partial answers, and the draft status.
--
-- No new compliance TRIGGER is required: Stage 1 collects no child PII, and the
-- non-identifying 2B allowlist is an application-layer concern (part B), not a
-- schema guarantee. This migration is the plain structural floor for both tables.
-- =========================================================================

-- --- enums ---------------------------------------------------------------
CREATE TYPE application_lead_status AS ENUM ('new', 'stage2_started', 'converted', 'deleted');
CREATE TYPE application_draft_phase AS ENUM ('2a', '2b', '2c', 'submitted');
CREATE TYPE application_draft_status AS ENUM ('in_progress', '2b_saved', 'sent_back', 'submitted');

-- --- Stage 1: lead capture -----------------------------------------------
CREATE TABLE application_lead (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                    citext NOT NULL,
  chapter_id               uuid REFERENCES chapter (id),
  referral_source          text NOT NULL,
  status                   application_lead_status NOT NULL DEFAULT 'new',
  -- The Stage 2 parent token (set when Stage 2 starts, part B). Null until then.
  token_hash               text,
  -- Set at 2C submit (part B) when the lead converts to a real application.
  converted_application_id uuid REFERENCES application (id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  deleted_at               timestamptz
);
CREATE INDEX application_lead_email_idx ON application_lead (email);
CREATE INDEX application_lead_status_created_idx ON application_lead (status, created_at);

-- --- Stage 2: the draft (populated by part B) ----------------------------
CREATE TABLE application_draft (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id                  uuid NOT NULL REFERENCES application_lead (id),
  parent_token_hash        text NOT NULL,
  student_token_hash       text,
  phase                    application_draft_phase NOT NULL,
  parent_answers           jsonb,
  student_answers          jsonb,
  status                   application_draft_status NOT NULL,
  converted_application_id uuid REFERENCES application (id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  submitted_at             timestamptz
);
CREATE INDEX application_draft_lead_idx ON application_draft (lead_id);

-- --- Mechanism A grants (0002) ------------------------------------------
-- The 0002 `GRANT ... ON ALL TABLES` bound only the tables that existed then, so
-- these new tables need their own grant. The application role gets full DML; the
-- analytics read role is deliberately NOT granted — application_lead holds a
-- parent contact email and application_draft holds parent-provided child facts,
-- so a missing grant is the guarantee that a read login cannot see them.
GRANT SELECT, INSERT, UPDATE, DELETE ON application_lead, application_draft TO curiolab_app;
