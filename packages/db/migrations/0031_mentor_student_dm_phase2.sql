-- =========================================================================
-- 0031_mentor_student_dm_phase2.sql -- mentor-student direct messaging (Phase 2),
-- the STRUCTURAL CONSTRAINTS layer over Phase 1's encrypted append-only thread
-- store (design C.4, C.5, C.11; Part E.2). ADDITIVE. Built DARK behind
-- MENTOR_DM_ENABLED (default false), COUNSEL-GATED (Part A/B). Synthetic data only.
--
-- Two additions:
--   1. Per-chapter CLOSED-HOURS override (design C.4). Sends are refused outside an
--      allowed local window (default 07:00-21:00, DmThreadService reads the default
--      from config). The chapter already carries `timezone` (0000_base); this adds
--      an OPTIONAL per-chapter override of the open/close hour. NULL = use the
--      config default. Reads are NEVER hours-gated.
--   2. dm_flag -- the append-only content-flag record (design C.5). A send whose
--      plaintext body matches a content matcher (Phase 2: contact-info patterns;
--      Phase 3 extends the categories) records a flag routed to the safety officer.
--      This does NOT block the send (friction, not a block). Append-only (the shared
--      reject_append_only_mutation() trigger + SELECT/INSERT-only role grants), like
--      dm_thread/dm_message. `detail` stores the matched KIND (e.g. 'email'), NEVER
--      the raw matched substring -- the body is encrypted at rest, so a flag must not
--      re-introduce the plaintext contact info in the clear.
--
-- --- Guarantees with a red-before-green test (test/dm-phase2-schema.test.ts) -----
--   * chapter.dm_open_hour / dm_close_hour exist, are nullable, and accept a value;
--   * dm_flag exists with the {id, thread_id, message_id, category, detail,
--     created_at} shape + fks to dm_thread/dm_message;
--   * dm_flag is APPEND-ONLY (UPDATE/DELETE rejected);
--   * Mechanism-A grants: app/rls SELECT+INSERT on dm_flag (not UPDATE/DELETE).
-- CURIOLAB_MIGRATE_UPTO=0030 witnesses the red state (the columns/relation are absent).
-- =========================================================================

-- --- Per-chapter closed-hours override (design C.4) ------------------------
-- The chapter already has `timezone` (0000_base). These OPTIONAL columns override
-- the config default window (07:00-21:00 local) per chapter; NULL = use the default.
-- Hours are 0-23 (a local wall-clock hour); the send service computes the sender's
-- local hour from the chapter timezone at the injected `now` and refuses outside
-- [open, close). A CHECK keeps the values in range.
ALTER TABLE chapter
  ADD COLUMN dm_open_hour  smallint,
  ADD COLUMN dm_close_hour smallint;

ALTER TABLE chapter
  ADD CONSTRAINT chapter_dm_open_hour_range
    CHECK (dm_open_hour IS NULL OR (dm_open_hour BETWEEN 0 AND 23)),
  ADD CONSTRAINT chapter_dm_close_hour_range
    CHECK (dm_close_hour IS NULL OR (dm_close_hour BETWEEN 0 AND 23));

-- --- dm_flag (append-only; content-flag record, design C.5) ----------------
-- One row per matched content flag on a message. `category` is the matcher family
-- (Phase 2: 'contact_info'); `detail` the matched KIND ('email'/'phone'/…), never
-- the raw plaintext match. Routed to the safety officer's reading queue (Phase 3).
CREATE TABLE dm_flag (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id  uuid NOT NULL REFERENCES dm_thread (id),
  message_id uuid NOT NULL REFERENCES dm_message (id),
  category   text NOT NULL,
  detail     text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dm_flag_thread_idx ON dm_flag (thread_id, created_at);
CREATE INDEX dm_flag_message_idx ON dm_flag (message_id);
CREATE INDEX dm_flag_category_idx ON dm_flag (category);

-- Append-only (trigger backstop; shares the 0001 function), like dm_message.
CREATE TRIGGER dm_flag_append_only
  BEFORE UPDATE OR DELETE ON dm_flag
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

-- --- Mechanism A grants (0002) ---------------------------------------------
-- dm_flag is append-only: app/rls SELECT+INSERT only (the role-level belt to the
-- trigger's braces), mirroring dm_thread/dm_message.
GRANT SELECT, INSERT ON dm_flag TO curiolab_app;
GRANT SELECT, INSERT ON dm_flag TO curiolab_rls;
