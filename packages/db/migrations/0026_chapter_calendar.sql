-- =========================================================================
-- 0026_chapter_calendar.sql — the shared, audience-scoped chapter calendar
-- (guardian/director portal work order, Feature 1), as an APPEND-ONLY
-- event-sourced log.
--
-- ADDITIVE. A director authors a chapter's calendar of sessions, orientations,
-- meetings, and other events. Each event carries a set of AUDIENCES (parent |
-- mentor | director) that scopes who may read it, precise timestamps (a
-- kind='session' event is the source of truth for attendance — Feature 2 reads
-- these real starts_at/ends_at), and optional location/notes.
--
-- WHY an append-only revision log (not a mutable row): calendar edits and cancels
-- are AUDITABLE platform invariants — nothing is destructively updated or hard-
-- deleted (the same posture as consent_grant / mentor_eligibility / access_ledger).
-- One row per (event, revision): a stable `event_id` identity across revisions, a
-- monotonically bumped `version`, a `status` (active|canceled), and the FULL field
-- snapshot (so every revision is a complete, immutable record of the event as it
-- stood — including its prior/next audience set for the audit/complaint trail). An
-- EDIT is a new active revision; a CANCEL is a new `canceled` tombstone revision;
-- neither mutates or deletes a row. This composes with the SAME
-- reject_append_only_mutation() trigger + role REVOKE that guard the other ledgers.
--
-- WHY audiences as an enum ARRAY (not a child rows table): the audience set is a
-- small, fixed-domain set queried by containment (`'parent' = ANY(audiences)`), and
-- it must travel ATOMICALLY inside each revision snapshot so the append-only record
-- is self-contained; a child table would fork the immutability (its own versioning
-- + trigger) and complicate the current-state projection. The enum bounds each
-- element; a CHECK bounds non-emptiness.
--
-- The current state per event is the `calendar_event_current` VIEW: the LATEST
-- revision per event_id, carrying the ORIGINAL creator/created_at forward (so the
-- event's createdBy/createdAt are the v1 values, while each revision's own actor is
-- captured in the audit + access-ledger rows the service writes).
--
-- --- Guarantees with a red-before-green test (test/chapter-calendar-schema.test.ts)
--   * calendar_event exists; the kind / audience / status enums; chapter/account
--     fks; audiences is a non-empty enum ARRAY;
--   * ends_at > starts_at and non-empty-audiences CHECKs bite;
--   * append-only (UPDATE/DELETE rejected by the trigger + role REVOKE);
--   * calendar_event_current reflects the latest revision per event_id, an edit /
--     cancel supersedes, and created_by/created_at stay the ORIGINAL v1 values;
--   * Mechanism-A grants: app SELECT/INSERT (not UPDATE/DELETE).
-- CURIOLAB_MIGRATE_UPTO=0025 witnesses the red state (the relations are absent).
-- =========================================================================

-- --- enums -----------------------------------------------------------------
CREATE TYPE calendar_event_kind AS ENUM ('session', 'orientation', 'meeting', 'other');

-- The audience set a director tags an event with; scopes who may read it.
CREATE TYPE calendar_audience AS ENUM ('parent', 'mentor', 'director');

-- active (a live event) | canceled (a tombstone revision; never a row delete).
CREATE TYPE calendar_event_status AS ENUM ('active', 'canceled');

-- --- calendar_event (append-only revision log) -----------------------------
-- One row per (event, revision). `id` is the revision id; `event_id` is the stable
-- event identity across revisions; `version` bumps per revision. A fresh event is
-- version 1 / status 'active'; an edit is a new active revision; a cancel is a new
-- 'canceled' tombstone. `created_by_account_id` / `created_at` are THIS revision's
-- author + time (the current-state view projects the ORIGINAL forward).
CREATE TABLE calendar_event (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq                   bigserial NOT NULL UNIQUE,
  event_id              uuid NOT NULL,
  chapter_id            uuid NOT NULL REFERENCES chapter (id),
  version               integer NOT NULL DEFAULT 1,
  status                calendar_event_status NOT NULL DEFAULT 'active',
  title                 text NOT NULL,
  kind                  calendar_event_kind NOT NULL,
  starts_at             timestamptz NOT NULL,
  ends_at               timestamptz NOT NULL,
  -- The audience set; a non-empty enum array (each element is enum-checked).
  audiences             calendar_audience[] NOT NULL,
  location              text,
  notes                 text,
  created_by_account_id uuid REFERENCES account (id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  -- A session (like every event) has a real, ordered time window; Feature 2's
  -- attendance reads these precise timestamps.
  CONSTRAINT calendar_event_time_order CHECK (ends_at > starts_at),
  -- The audience set is never empty (cardinality, not array_length: an empty array
  -- has array_length NULL, which would slip past a `>= 1` NULL-is-not-false check).
  CONSTRAINT calendar_event_audiences_nonempty CHECK (cardinality(audiences) >= 1)
);

CREATE INDEX calendar_event_event_seq_idx ON calendar_event (event_id, seq DESC);
CREATE INDEX calendar_event_chapter_idx ON calendar_event (chapter_id, seq DESC);
-- Audience containment is the read filter (parent for guardians, mentor for staff);
-- a GIN index makes `audiences && array[...]` / `= ANY(audiences)` cheap.
CREATE INDEX calendar_event_audiences_idx ON calendar_event USING gin (audiences);

-- --- Append-only enforcement (trigger backstop; shares the 0001 function) ---
CREATE TRIGGER calendar_event_append_only
  BEFORE UPDATE OR DELETE ON calendar_event
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

-- --- calendar_event_current (the current-state projection) ------------------
-- The LATEST revision per event_id is authoritative (DISTINCT ON event_id ORDER BY
-- seq DESC). The event's createdBy/createdAt are the ORIGINAL v1 values, computed
-- with first_value over the event partition ordered ASC — so the current row shows
-- the latest fields but the original creation provenance. A VIEW, always correct
-- without a maintenance trigger. Reads that want live events filter status='active'.
CREATE VIEW calendar_event_current AS
SELECT DISTINCT ON (event_id)
  event_id,
  id AS revision_id,
  chapter_id,
  version,
  status,
  title,
  kind,
  starts_at,
  ends_at,
  audiences,
  location,
  notes,
  first_value(created_by_account_id) OVER (PARTITION BY event_id ORDER BY seq ASC)
    AS created_by_account_id,
  first_value(created_at) OVER (PARTITION BY event_id ORDER BY seq ASC)
    AS created_at
FROM calendar_event
ORDER BY event_id, seq DESC;

-- --- Mechanism A grants (0002) ---------------------------------------------
-- calendar_event is append-only: the app / rls roles SELECT+INSERT only (the
-- role-level belt to the trigger's braces), mirroring consent_grant /
-- mentor_eligibility / access_ledger.
GRANT SELECT, INSERT ON calendar_event TO curiolab_app;
GRANT SELECT, INSERT ON calendar_event TO curiolab_rls;
GRANT SELECT ON calendar_event_current TO curiolab_app;
GRANT SELECT ON calendar_event_current TO curiolab_rls;

-- The bigserial `seq` sequence needs its own USAGE grant (0002's ON ALL SEQUENCES
-- bound only the sequences that existed then).
GRANT USAGE, SELECT ON SEQUENCE calendar_event_seq_seq TO curiolab_app, curiolab_rls;
