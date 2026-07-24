-- =========================================================================
-- 0028_messaging.sql — guardian <-> chapter-staff MESSAGING (guardian/director
-- portal work order, Feature 3), as an APPEND-ONLY log retained like email.
--
-- ADDITIVE. A guardian and a chapter's staff (the chapter_director + that
-- chapter's mentors) hold a threaded conversation. A `message_thread` is one
-- guardian<->chapter conversation; a `message` is one post in it. NOTHING is ever
-- edited in place or hard-deleted: a correction is a new message, retained
-- forever — the same posture as calendar_event / attendance_exception /
-- access_ledger. Both tables compose with the SAME reject_append_only_mutation()
-- trigger (migration 0001) + role REVOKE (SELECT/INSERT-only grants).
--
-- WHY message_thread is append-only WITHOUT a mutable last_message_at column:
-- the thread row is INSERT-once (its chapter, guardian, subject, and creation
-- time never change). `last_message_at` — which must ADVANCE as replies append —
-- is NOT stored and mutated (that would require an UPDATE the append-only trigger
-- rejects, or a carve-out that forks the immutability guarantee). Instead it is
-- DERIVED by the `message_thread_current` projection view as max(sent_at) over the
-- thread's messages (coalesced to created_at when the thread has none yet). The
-- "advance" is thus a projection over the append-only message log, never a
-- destructive mutation — the cleanest reading of "both tables append-only".
--
-- WHY message.thread_id IS a real FK (unlike attendance.session_event_id, which is
-- logical): message_thread.id is a stable PRIMARY KEY (one row per thread), so a
-- message can reference it directly. sender_role is a checked enum written
-- SERVER-SIDE from the sender's membership at send time (a guardian -> 'guardian',
-- a chapter_director -> 'director', a mentor tier -> 'mentor'); the DB enum is the
-- floor, the service never trusts a client-supplied role.
--
-- --- Guarantees with a red-before-green test (test/messaging-schema.test.ts)
--   * message_thread + message exist; the message_sender_role enum; account/thread
--     fks; body NOT NULL;
--   * message_thread_current derives last_message_at = max(sent_at) (created_at
--     when there are no messages yet);
--   * append-only (UPDATE/DELETE rejected by the trigger + role REVOKE) on BOTH;
--   * Mechanism-A grants: app SELECT/INSERT (not UPDATE/DELETE).
-- CURIOLAB_MIGRATE_UPTO=0027 witnesses the red state (the relations are absent).
-- =========================================================================

-- --- enum ------------------------------------------------------------------
-- Who sent a message, DERIVED server-side from the sender's membership at send
-- time. guardian (the thread's guardian) | mentor (a mentor tier) | director (the
-- chapter_director). Never trusted from the client.
CREATE TYPE message_sender_role AS ENUM ('guardian', 'mentor', 'director');

-- --- message_thread (INSERT-once; append-only) -----------------------------
-- One row per guardian<->chapter conversation. The thread is identified by its
-- stable `id` (opaque; never a PII value in a URL). `chapter_id` is the guardian's
-- child's chapter (resolved server-side from the verified guardianship ->
-- enrollment/membership -> chapter). `subject` is an optional headline. The row is
-- INSERT-once — no column is ever mutated (last_message_at is derived by the view).
CREATE TABLE message_thread (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id          uuid NOT NULL REFERENCES chapter (id),
  guardian_account_id uuid NOT NULL REFERENCES account (id),
  subject             text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX message_thread_guardian_idx ON message_thread (guardian_account_id);
CREATE INDEX message_thread_chapter_idx ON message_thread (chapter_id);

-- --- message (append-only) -------------------------------------------------
-- One post in a thread. `seq` gives a total, gap-tolerant order within a thread
-- (bigserial). `sender_role` is the server-derived capacity of the sender at send
-- time. Append-only: a correction is a NEW message, never an UPDATE.
CREATE TABLE message (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq               bigserial NOT NULL UNIQUE,
  thread_id         uuid NOT NULL REFERENCES message_thread (id),
  sender_account_id uuid NOT NULL REFERENCES account (id),
  sender_role       message_sender_role NOT NULL,
  body              text NOT NULL,
  sent_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX message_thread_seq_idx ON message (thread_id, seq);

-- --- Append-only enforcement (trigger backstop; shares the 0001 function) ---
CREATE TRIGGER message_thread_append_only
  BEFORE UPDATE OR DELETE ON message_thread
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER message_append_only
  BEFORE UPDATE OR DELETE ON message
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

-- --- message_thread_current (the current-state projection) ------------------
-- The thread's fields plus a DERIVED `last_message_at` = max(sent_at) over its
-- messages, coalesced to the thread's created_at when it has none yet. A VIEW,
-- always correct without a maintenance trigger — so the thread row stays immutable
-- while last_message_at advances forward as replies append. `message_count` is a
-- convenience for the staff list.
CREATE VIEW message_thread_current AS
SELECT
  mt.id,
  mt.chapter_id,
  mt.guardian_account_id,
  mt.subject,
  mt.created_at,
  COALESCE(max(m.sent_at), mt.created_at) AS last_message_at,
  count(m.id) AS message_count
FROM message_thread mt
LEFT JOIN message m ON m.thread_id = mt.id
GROUP BY mt.id;

-- --- Mechanism A grants (0002) ---------------------------------------------
-- message_thread + message are append-only: the app / rls roles SELECT+INSERT only
-- (the role-level belt to the trigger's braces), mirroring calendar_event /
-- attendance_exception / access_ledger.
GRANT SELECT, INSERT ON message_thread TO curiolab_app;
GRANT SELECT, INSERT ON message_thread TO curiolab_rls;
GRANT SELECT, INSERT ON message TO curiolab_app;
GRANT SELECT, INSERT ON message TO curiolab_rls;
GRANT SELECT ON message_thread_current TO curiolab_app;
GRANT SELECT ON message_thread_current TO curiolab_rls;

-- The bigserial `seq` sequence needs its own USAGE grant (0002's ON ALL SEQUENCES
-- bound only the sequences that existed then).
GRANT USAGE, SELECT ON SEQUENCE message_seq_seq TO curiolab_app, curiolab_rls;
