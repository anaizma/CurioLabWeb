-- =========================================================================
-- 0027_attendance.sql — attendance & make-up check-ins (guardian/director
-- portal work order, Feature 2), as an APPEND-ONLY event-sourced log.
--
-- ADDITIVE. A guardian records that their child was ABSENT or LATE for a chapter
-- SESSION (a kind='session' calendar_event from Feature 1, migration 0026,
-- referenced by its stable event_id). An ABSENT exception carries a make-up: a
-- 30-minute virtual check-in the student completes after finishing that session's
-- assignment, scheduled BEFORE the chapter's next session. Staff (a mentor /
-- director) later mark the check-in DONE. A LATE exception carries an arrive_at
-- and has NO make-up.
--
-- WHY an append-only revision log (not a mutable row): an attendance record — and
-- especially a make-up COMPLETION — is an AUDITABLE platform invariant. Nothing is
-- destructively updated or hard-deleted (the same posture as calendar_event /
-- consent_grant / access_ledger). One row per (exception, revision): a stable
-- `exception_id` identity across revisions, a monotonically bumped `version`, and
-- the FULL field snapshot. A make-up COMPLETION is a NEW row (makeup_status ->
-- 'completed'), never an UPDATE of the prior row; a correction/revocation is
-- likewise a new row. This composes with the SAME reject_append_only_mutation()
-- trigger + role REVOKE that guard the other ledgers.
--
-- WHY makeup_slots as a timestamptz ARRAY (not a child rows table): the proposed
-- check-in times are a small set that must travel ATOMICALLY inside each revision
-- snapshot so the append-only record is self-contained; a child table would fork
-- the immutability (its own versioning + trigger) and complicate the current-state
-- projection. The slots-before-next-session validation is a SERVER-SIDE service
-- concern (AttendanceService), not a DB CHECK — it depends on the calendar.
--
-- session_event_id references the calendar SESSION's stable event_id (0026). It is
-- NOT a FK: calendar_event.event_id is not unique (one row per revision), so the
-- reference is logical (resolved through the calendar_event_current view), exactly
-- as the calendar's own edit/cancel anchor is by event_id.
--
-- The current state per exception is the `attendance_exception_current` VIEW: the
-- LATEST revision per exception_id, carrying the ORIGINAL guardian/created_at
-- forward (so the exception's createdBy/createdAt are the v1 values, while each
-- revision's own actor — the completing mentor — is captured in the audit +
-- access-ledger rows the service writes).
--
-- --- Guarantees with a red-before-green test (test/attendance-schema.test.ts)
--   * attendance_exception exists; the type / makeup_status enums; account fks;
--     makeup_slots is a timestamptz ARRAY;
--   * the "late carries no make-up" and "absent has a make-up status" CHECKs bite;
--   * append-only (UPDATE/DELETE rejected by the trigger + role REVOKE);
--   * attendance_exception_current reflects the latest revision per exception_id, a
--     completion revision supersedes, and created_by/created_at stay the ORIGINAL;
--   * Mechanism-A grants: app SELECT/INSERT (not UPDATE/DELETE).
-- CURIOLAB_MIGRATE_UPTO=0026 witnesses the red state (the relations are absent).
-- =========================================================================

-- --- enums -----------------------------------------------------------------
-- absent (a make-up-bearing miss) | late (an arrive_at, no make-up).
CREATE TYPE attendance_exception_type AS ENUM ('absent', 'late');

-- The make-up lifecycle for an ABSENT exception. NULL for a late one (no make-up).
-- pending  = absent recorded, slots not yet validated/on file (reserved).
-- scheduled = validated slots on file, check-in not yet done.
-- completed = staff marked the 30-minute check-in done (a NEW revision).
CREATE TYPE makeup_status AS ENUM ('pending', 'scheduled', 'completed');

-- --- attendance_exception (append-only revision log) -----------------------
-- One row per (exception, revision). `id` is the revision id; `exception_id` is
-- the stable exception identity across revisions; `version` bumps per revision. A
-- fresh exception is version 1; a make-up completion is a new revision carrying the
-- same snapshot with makeup_status -> 'completed'. `created_by_guardian_account_id`
-- / `created_at` are THIS revision's author + time (the current-state view projects
-- the ORIGINAL guardian/time forward).
CREATE TABLE attendance_exception (
  id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq                            bigserial NOT NULL UNIQUE,
  exception_id                   uuid NOT NULL,
  student_account_id             uuid NOT NULL REFERENCES account (id),
  -- The calendar SESSION's stable event_id (0026). Logical, not a FK (event_id is
  -- not unique — one row per revision); resolved via calendar_event_current.
  session_event_id               uuid NOT NULL,
  version                        integer NOT NULL DEFAULT 1,
  type                           attendance_exception_type NOT NULL,
  reason                         text,
  -- Late only: when the student actually arrived.
  arrive_at                      timestamptz,
  -- Absent only: the guardian consented to the make-up. Irrelevant for late.
  makeup_consent                 boolean NOT NULL DEFAULT false,
  -- Absent only: the proposed 30-minute check-in times (validated server-side to
  -- fall after the missed session and before the chapter's next session).
  makeup_slots                   timestamptz[] NOT NULL DEFAULT '{}',
  -- Absent: pending|scheduled|completed. Late: NULL (no make-up).
  makeup_status                  makeup_status,
  created_by_guardian_account_id uuid NOT NULL REFERENCES account (id),
  created_at                     timestamptz NOT NULL DEFAULT now(),
  -- A LATE exception has no make-up: no status, no slots. (It carries arrive_at.)
  CONSTRAINT attendance_late_no_makeup CHECK (
    type <> 'late' OR (makeup_status IS NULL AND cardinality(makeup_slots) = 0)
  ),
  -- An ABSENT exception always carries a make-up status (scheduled on the validated
  -- path; pending is reserved). Never NULL for an absence.
  CONSTRAINT attendance_absent_has_status CHECK (
    type <> 'absent' OR makeup_status IS NOT NULL
  )
);

CREATE INDEX attendance_exception_exc_seq_idx
  ON attendance_exception (exception_id, seq DESC);
CREATE INDEX attendance_exception_student_seq_idx
  ON attendance_exception (student_account_id, seq DESC);
-- The roster read filters by session; the counts read by student. A session index
-- makes "who missed this session" cheap.
CREATE INDEX attendance_exception_session_idx
  ON attendance_exception (session_event_id, seq DESC);

-- --- Append-only enforcement (trigger backstop; shares the 0001 function) ---
CREATE TRIGGER attendance_exception_append_only
  BEFORE UPDATE OR DELETE ON attendance_exception
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

-- --- attendance_exception_current (the current-state projection) ------------
-- The LATEST revision per exception_id is authoritative (DISTINCT ON exception_id
-- ORDER BY seq DESC). The exception's createdBy/createdAt are the ORIGINAL v1
-- values, computed with first_value over the exception partition ordered ASC — so
-- the current row shows the latest make-up status but the original guardian/time.
-- A VIEW, always correct without a maintenance trigger.
CREATE VIEW attendance_exception_current AS
SELECT DISTINCT ON (exception_id)
  exception_id,
  id AS revision_id,
  student_account_id,
  session_event_id,
  version,
  type,
  reason,
  arrive_at,
  makeup_consent,
  makeup_slots,
  makeup_status,
  first_value(created_by_guardian_account_id)
    OVER (PARTITION BY exception_id ORDER BY seq ASC)
    AS created_by_guardian_account_id,
  first_value(created_at) OVER (PARTITION BY exception_id ORDER BY seq ASC)
    AS created_at
FROM attendance_exception
ORDER BY exception_id, seq DESC;

-- --- Mechanism A grants (0002) ---------------------------------------------
-- attendance_exception is append-only: the app / rls roles SELECT+INSERT only (the
-- role-level belt to the trigger's braces), mirroring calendar_event / consent_grant.
GRANT SELECT, INSERT ON attendance_exception TO curiolab_app;
GRANT SELECT, INSERT ON attendance_exception TO curiolab_rls;
GRANT SELECT ON attendance_exception_current TO curiolab_app;
GRANT SELECT ON attendance_exception_current TO curiolab_rls;

-- The bigserial `seq` sequence needs its own USAGE grant (0002's ON ALL SEQUENCES
-- bound only the sequences that existed then).
GRANT USAGE, SELECT ON SEQUENCE attendance_exception_seq_seq TO curiolab_app, curiolab_rls;
