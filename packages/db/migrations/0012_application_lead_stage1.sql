-- =========================================================================
-- 0012_application_lead_stage1.sql — align `application_lead` to the approved
-- Stage-1 design (docs/superpowers/specs/2026-07-22-application-funnel-stage-1-
-- design.md §7.1). ADDITIVE: this ALTERs the table 0010 created; it does not
-- rewrite 0010.
--
-- The design's Stage-1 record collects a parent email, a chapter CODE, an
-- optional "how did you hear", and who filled the form (parent/student, which
-- drives the confirmation copy). A Stage-2 token is issued now (forward-compat)
-- and a 30-day expiry is stamped — the § 312.4(c)(1)(vii) deletion floor, now
-- read directly off `expires_at` instead of recomputed from `created_at`. A
-- `converted_at` marker is set when a Stage-2 application is submitted at 2C.
--
-- Changes vs 0010:
--   referral_source (text NOT NULL)  -> renamed `source`, made NULLABLE (optional)
--   chapter_id (fk)                  -> kept NULLABLE as an optional 2C linkage,
--                                       and a NEW `chapter` TEXT CODE becomes the
--                                       design field (so "interested in another
--                                       school", which has no chapter row, is
--                                       expressible).
--   + filler_role  enum(parent,student) NOT NULL  (drives the confirmation copy)
--   + expires_at   timestamptz NOT NULL           (created_at + 30 days)
--   + converted_at timestamptz NULL               (the design's conversion marker)
--
-- `status`, `token_hash`, `converted_application_id`, and `deleted_at` are kept
-- as backend linkage/lifecycle state (additive-first; no destructive drops).
-- =========================================================================

-- --- source: rename referral_source and relax to nullable ----------------
ALTER TABLE application_lead RENAME COLUMN referral_source TO source;
ALTER TABLE application_lead ALTER COLUMN source DROP NOT NULL;

-- --- chapter: a NOT-NULL text CODE (chapter_id kept as the optional fk) ---
ALTER TABLE application_lead ADD COLUMN chapter text;
-- Backfill existing rows from the chapter they referenced (slug is the code),
-- or a placeholder when they named no chapter, so the NOT NULL can be set.
UPDATE application_lead l SET chapter = c.slug FROM chapter c WHERE c.id = l.chapter_id;
UPDATE application_lead SET chapter = 'unknown' WHERE chapter IS NULL;
ALTER TABLE application_lead ALTER COLUMN chapter SET NOT NULL;
-- chapter_id was NOT NULL-able already (nullable) — keep it as the optional 2C
-- linkage populated when the code maps to a real chapter.

-- --- filler_role: who filled Stage 1 (parent | student) ------------------
CREATE TYPE application_lead_filler_role AS ENUM ('parent', 'student');
-- Add with a temporary default so existing rows backfill, then drop the default
-- so the design's "NOT NULL, always provided by createLead" holds for new rows.
ALTER TABLE application_lead ADD COLUMN filler_role application_lead_filler_role NOT NULL DEFAULT 'parent';
ALTER TABLE application_lead ALTER COLUMN filler_role DROP DEFAULT;

-- --- expires_at: the retention/deletion floor (created_at + 30 days) ------
ALTER TABLE application_lead ADD COLUMN expires_at timestamptz;
UPDATE application_lead SET expires_at = created_at + interval '30 days' WHERE expires_at IS NULL;
ALTER TABLE application_lead ALTER COLUMN expires_at SET NOT NULL;
-- A default keeps ad-hoc/seed inserts valid; createLead sets it explicitly to
-- created_at + 30d so the invariant is exact.
ALTER TABLE application_lead ALTER COLUMN expires_at SET DEFAULT (now() + interval '30 days');

-- --- converted_at: the design's conversion marker (set at 2C submit) ------
ALTER TABLE application_lead ADD COLUMN converted_at timestamptz;
-- Backfill: any already-converted lead is marked converted as of now.
UPDATE application_lead SET converted_at = now() WHERE status = 'converted' AND converted_at IS NULL;

-- The unconverted-lead sweep now filters on (converted_at IS NULL AND
-- expires_at < now); index that access path.
CREATE INDEX application_lead_expiry_sweep_idx ON application_lead (expires_at) WHERE converted_at IS NULL;
