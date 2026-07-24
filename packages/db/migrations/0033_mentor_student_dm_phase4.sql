-- =========================================================================
-- 0033_mentor_student_dm_phase4.sql -- mentor-student direct messaging (Phase 4),
-- the PARTICIPANT & GUARDIAN SURFACES layer over Phase 1/2/3's encrypted
-- append-only thread store + detection/oversight (design C.2, C.10, C.12; Part
-- E.4). ADDITIVE. Built DARK behind MENTOR_DM_ENABLED (default false),
-- COUNSEL-GATED (Part A/B). Synthetic data only.
--
-- Two additions, BOTH APPEND-ONLY (the shared reject_append_only_mutation()
-- trigger from 0001 + SELECT/INSERT-only role grants, like dm_thread/dm_message/
-- dm_flag) -- no edit, no delete, by anyone, ever.
--
--   1. dm_onboarding_ack (C.12) -- the student's first-open onboarding
--      acknowledgement. Shown the first time a student opens any thread (who reads
--      this, what happens when you report, that reporting does not get anyone in
--      trouble by default). A row records that this student acknowledged it; the
--      "acknowledged" state is the existence of a row. Append-only (a re-ack is a
--      new row).
--   2. dm_report (C.12) -- the low-key "something feels off" student report. A
--      participant (the student, primarily) files a report that routes to the
--      SAFETY OFFICER and does NOT notify the mentor. `note` is an optional free
--      reference. The routing is a monitoring-ledger entry (dm.student_report),
--      NOT a mentor-visible signal -- the mentor has no read path to dm_report.
--
-- --- Guarantees with a red-before-green test (test/dm-phase4-schema.test.ts) ---
--   * dm_onboarding_ack / dm_report exist with the documented shape + fks; each is
--     APPEND-ONLY (UPDATE/DELETE rejected); Mechanism-A grants (SELECT+INSERT);
--   * dm_report.note is optional (NULL allowed).
-- CURIOLAB_MIGRATE_UPTO=0032 witnesses the red state (the relations are absent).
-- =========================================================================

-- --- dm_onboarding_ack (append-only; design C.12) --------------------------
-- One row each time a student acknowledges the first-open onboarding screen. The
-- "acknowledged" state is COMPUTED (any row exists for the student). Append-only.
CREATE TABLE dm_onboarding_ack (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_account_id uuid NOT NULL REFERENCES account (id),
  acknowledged_at    timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dm_onboarding_ack_student_idx ON dm_onboarding_ack (student_account_id);
CREATE TRIGGER dm_onboarding_ack_append_only
  BEFORE UPDATE OR DELETE ON dm_onboarding_ack
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

-- --- dm_report (append-only; design C.12) ----------------------------------
-- The "something feels off" student report. Routed to the safety officer via a
-- monitoring-ledger entry (dm.student_report); the mentor is NEVER notified and
-- has no read path here. `note` is an optional free reference, never required (a
-- minor may report without explaining). Append-only (a report is a permanent
-- record; a follow-up is a new row).
CREATE TABLE dm_report (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id           uuid NOT NULL REFERENCES dm_thread (id),
  reporter_account_id uuid NOT NULL REFERENCES account (id),
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dm_report_thread_idx ON dm_report (thread_id, created_at);
CREATE INDEX dm_report_reporter_idx ON dm_report (reporter_account_id);
CREATE TRIGGER dm_report_append_only
  BEFORE UPDATE OR DELETE ON dm_report
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

-- --- Mechanism A grants (0002) ---------------------------------------------
-- Both tables are append-only: app/rls SELECT+INSERT only (the role-level belt to
-- the trigger's braces), mirroring dm_thread/dm_message/dm_flag.
GRANT SELECT, INSERT ON dm_onboarding_ack TO curiolab_app;
GRANT SELECT, INSERT ON dm_onboarding_ack TO curiolab_rls;
GRANT SELECT, INSERT ON dm_report TO curiolab_app;
GRANT SELECT, INSERT ON dm_report TO curiolab_rls;
