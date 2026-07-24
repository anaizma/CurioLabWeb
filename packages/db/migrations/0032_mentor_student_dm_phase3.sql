-- =========================================================================
-- 0032_mentor_student_dm_phase3.sql -- mentor-student direct messaging (Phase 3),
-- the DETECTION & OVERSIGHT layer over Phase 1/2's encrypted append-only thread
-- store (design C.6, C.7, C.8, C.15; Part E.3). ADDITIVE. Built DARK behind
-- MENTOR_DM_ENABLED (default false), COUNSEL-GATED (Part A/B). Synthetic data only.
--
-- Four additions, ALL APPEND-ONLY (the shared reject_append_only_mutation() trigger
-- from 0001 + SELECT/INSERT-only role grants, like dm_thread/dm_message/dm_flag) --
-- no edit, no delete, by anyone, ever. In particular the safety officer CANNOT
-- modify the monitoring record: the append-only floor is the DATABASE, not code.
--
--   1. dm_read_receipt (C.6) -- the per-thread read-receipt. A safety officer
--      marking a thread read records a receipt up to the latest `seq`; the
--      monitoring ledger then shows 100% coverage (every message at or below a
--      receipt is "read"). Reader-scoped so coverage is attributable.
--   2. dm_flag_review (C.7) -- the safety officer's disposition of a raised flag
--      (dm_flag is itself append-only, so a review is a NEW record, not an update).
--      Backs the quarterly report's "flags raised + disposition".
--   3. dm_visibility_suspension (C.8) -- the two-adult guardian-visibility
--      suspension, EVENT-SOURCED as append-only lifecycle rows grouped by
--      `suspension_id` (initiated -> acknowledged -> revoked), because append-only
--      INSERT-only grants forbid the UPDATE a single mutable row would need. This
--      mirrors the consent_grant grant/revocation pattern (a state change is a new
--      row). "Active" is COMPUTED (an initiation, unexpired, acknowledged, not
--      revoked); nothing persists silently -- expiry is a timestamp, restore is the
--      absence of a fresh initiation. A CHECK requires an initiation to carry its
--      reason + initiator + expiry (the recorded-reason floor, design C.8).
--   4. dm_thread_freeze (C.15) -- the mentor-departure freeze/preserve record. A
--      thread is FROZEN iff a row exists (one per thread); the thread itself is
--      never mutated or deleted (dm_thread is INSERT-once). Carries the handoff
--      decision (whether the student gets a safety-officer conversation is a
--      RECORDED decision field, not improvised).
--
-- --- Guarantees with a red-before-green test (test/dm-phase3-schema.test.ts) -----
--   * dm_read_receipt / dm_flag_review / dm_visibility_suspension / dm_thread_freeze
--     exist with the documented shape + fks; each is APPEND-ONLY (UPDATE/DELETE
--     rejected); Mechanism-A grants (app/rls SELECT+INSERT, not UPDATE/DELETE);
--   * an initiated suspension row REQUIRES a reason (CHECK); acknowledgement +
--     revocation are separate append-only event rows;
--   * dm_thread_freeze is one-per-thread (unique) with a NOT-NULL handoff_decision.
-- CURIOLAB_MIGRATE_UPTO=0031 witnesses the red state (the relations are absent).
-- =========================================================================

-- --- dm_read_receipt (append-only; design C.6) -----------------------------
-- One row each time a reader (the safety officer) marks a thread read up to a
-- `seq`. Coverage is COMPUTED: a message is "read" iff its seq <= the max
-- up_to_seq receipt for the thread. Append-only (a re-mark is a new, higher row).
CREATE TABLE dm_read_receipt (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id         uuid NOT NULL REFERENCES dm_thread (id),
  reader_account_id uuid NOT NULL REFERENCES account (id),
  up_to_seq         bigint NOT NULL,
  read_at           timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dm_read_receipt_thread_idx ON dm_read_receipt (thread_id, up_to_seq);
CREATE INDEX dm_read_receipt_reader_idx ON dm_read_receipt (reader_account_id);
CREATE TRIGGER dm_read_receipt_append_only
  BEFORE UPDATE OR DELETE ON dm_read_receipt
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

-- --- dm_flag_review (append-only; design C.7) ------------------------------
-- The safety officer's disposition of a raised dm_flag. `disposition` is a free
-- label (e.g. benign / escalated / actioned); `note` is an optional REFERENCE,
-- never the raw message body. A review is a new record (dm_flag is append-only).
CREATE TABLE dm_flag_review (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_id     uuid NOT NULL REFERENCES dm_flag (id),
  reviewed_by uuid NOT NULL REFERENCES account (id),
  disposition text NOT NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dm_flag_review_flag_idx ON dm_flag_review (flag_id);
CREATE TRIGGER dm_flag_review_append_only
  BEFORE UPDATE OR DELETE ON dm_flag_review
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

-- --- dm_visibility_suspension (append-only, event-sourced; design C.8) ------
-- The guarded, two-adult suspension of a guardian's standing read access. Modeled
-- as append-only lifecycle EVENT rows grouped by `suspension_id`:
--   * 'initiated'    -- the safety officer records a REASON, the 90-day expiry, and
--                       that the mandatory-reporter checkpoint was surfaced.
--   * 'acknowledged' -- a SECOND adult (not a mentor in the chapter -- enforced in
--                       the service) brings it into effect; carries second_adult.
--   * 'revoked'      -- an early lift before expiry.
-- Per-STUDENT scope by default (thread_id NULL = all the student's threads),
-- because guardian standing access is a property of the guardian<->student
-- relationship, not one conversation; an optional thread_id narrows it. "Active" is
-- COMPUTED by the service (an initiation, unexpired, acknowledged, not revoked).
CREATE TABLE dm_visibility_suspension (
  id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event                          text NOT NULL
                                   CHECK (event IN ('initiated','acknowledged','revoked')),
  -- the initiation this row belongs to; for an 'initiated' row this equals id.
  suspension_id                  uuid NOT NULL,
  student_account_id             uuid NOT NULL REFERENCES account (id),
  thread_id                      uuid REFERENCES dm_thread (id),
  initiated_by_safety_officer_id uuid REFERENCES account (id),
  reason                         text,
  second_adult_account_id        uuid REFERENCES account (id),
  expires_at                     timestamptz,
  reporter_checkpoint_ack        boolean NOT NULL DEFAULT false,
  actor_account_id               uuid REFERENCES account (id),
  created_at                     timestamptz NOT NULL DEFAULT now(),
  -- The recorded-reason floor (design C.8): an initiation MUST carry its reason,
  -- its initiating officer, and its expiry. A DB CHECK, not app code.
  CONSTRAINT dm_visibility_suspension_initiated_requires_reason CHECK (
    event <> 'initiated'
    OR (reason IS NOT NULL AND initiated_by_safety_officer_id IS NOT NULL AND expires_at IS NOT NULL)
  )
);
CREATE INDEX dm_visibility_suspension_student_idx ON dm_visibility_suspension (student_account_id);
CREATE INDEX dm_visibility_suspension_group_idx ON dm_visibility_suspension (suspension_id, event);
CREATE TRIGGER dm_visibility_suspension_append_only
  BEFORE UPDATE OR DELETE ON dm_visibility_suspension
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

-- --- dm_thread_freeze (append-only; design C.15) ---------------------------
-- The mentor-departure freeze/preserve record. A thread is FROZEN iff a row
-- exists (one per thread); the frozen thread accepts NO new messages but remains
-- readable to the authorized parties and is NEVER deleted. `handoff_decision` is a
-- REQUIRED recorded field (the student gets a successor mentor, a paused channel,
-- or a safety-officer conversation -- decided by protocol, not improvised).
CREATE TABLE dm_thread_freeze (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id             uuid NOT NULL REFERENCES dm_thread (id),
  mentor_membership_id  uuid NOT NULL REFERENCES membership (id),
  reason                text,
  handoff_decision      text NOT NULL,
  frozen_by_account_id  uuid REFERENCES account (id),
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX dm_thread_freeze_thread_unique ON dm_thread_freeze (thread_id);
CREATE TRIGGER dm_thread_freeze_append_only
  BEFORE UPDATE OR DELETE ON dm_thread_freeze
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

-- --- Mechanism A grants (0002) ---------------------------------------------
-- All four tables are append-only: app/rls SELECT+INSERT only (the role-level belt
-- to the trigger's braces), mirroring dm_thread/dm_message/dm_flag.
GRANT SELECT, INSERT ON dm_read_receipt TO curiolab_app;
GRANT SELECT, INSERT ON dm_read_receipt TO curiolab_rls;
GRANT SELECT, INSERT ON dm_flag_review TO curiolab_app;
GRANT SELECT, INSERT ON dm_flag_review TO curiolab_rls;
GRANT SELECT, INSERT ON dm_visibility_suspension TO curiolab_app;
GRANT SELECT, INSERT ON dm_visibility_suspension TO curiolab_rls;
GRANT SELECT, INSERT ON dm_thread_freeze TO curiolab_app;
GRANT SELECT, INSERT ON dm_thread_freeze TO curiolab_rls;
