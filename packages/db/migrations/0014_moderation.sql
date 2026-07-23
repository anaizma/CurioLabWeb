-- =========================================================================
-- 0014_moderation.sql — Milestone 2.4: the moderation_report table (The Lab).
-- (docs/platform/plans/milestone-2.md §M2.4; 02-data-model.md "moderation_report";
-- 04-state-machines.md "Moderation report".)
--
-- The report a member files against a piece of feed content, and the queue a
-- moderator works. State is derived from the lifecycle timestamps (filed_at set,
-- then acknowledged_at, then resolved_at; escalated_at reachable from any
-- pre-resolution state) rather than a status column — the timestamps ARE the
-- audit trail. The SLA is a GENERATED column: 24h for a `safety` report, 72h for
-- an `ordinary` one, computed from filed_at so it can never drift from the class.
--
-- This migration is additive and structural: one table, its four enums, the
-- generated due_at, the partial index over the open queue, and the Mechanism-A
-- grants (the app role gets DML; the analytics read role is deliberately NOT
-- granted, the same default-deny stance the other sensitive tables use).
--
-- Scope note: no service or HTTP route here (those are the M2.4 app layer and
-- M2.6). target_type carries post/comment/project_media/profile_narrative, but
-- only post/comment are wired in M2 — the other two are M3 targets.
--
-- Guarantees with a red-before-green test in test/moderation.test.ts:
--   * due_at = filed_at + 24h for `safety`, + 72h for `ordinary` (generated);
--   * a client-supplied due_at is rejected (it is GENERATED ALWAYS);
--   * the enum/nullability/fk discipline;
--   * the partial index (due_at) WHERE resolved_at IS NULL exists;
--   * the app role may DML; the analytics role is denied SELECT.
-- CURIOLAB_MIGRATE_UPTO=0013 witnesses the red state (the relation is absent).
-- =========================================================================

-- --- enums (mirror packages/db/src/enums.ts) -----------------------------
CREATE TYPE moderation_target_type AS ENUM (
  'post', 'comment', 'project_media', 'profile_narrative'
);
CREATE TYPE moderation_class AS ENUM ('safety', 'ordinary');
CREATE TYPE moderation_reason AS ENUM (
  'harmful', 'sexual', 'threatening', 'self_harm_disclosure',
  'off_topic', 'unkind', 'spam', 'quality'
);
CREATE TYPE moderation_action AS ENUM (
  'none', 'hidden', 'removed', 'dismissed', 'escalated'
);

-- --- moderation_report ---------------------------------------------------
CREATE TABLE moderation_report (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type           moderation_target_type NOT NULL,
  -- Polymorphic reference discriminated by target_type; carries no foreign key
  -- (the target may be a post, comment, project_media, or profile_narrative).
  target_id             uuid NOT NULL,
  -- The reporter is an ACCOUNT, not a membership, so platform actors with no
  -- membership can file (02-data-model.md).
  reporter_account_id   uuid NOT NULL REFERENCES account (id),
  chapter_id            uuid NOT NULL REFERENCES chapter (id),
  class                 moderation_class NOT NULL,
  reason                moderation_reason NOT NULL,
  filed_at              timestamptz NOT NULL DEFAULT now(),
  -- The SLA. GENERATED ALWAYS so it cannot drift from the class or be forged by
  -- a client: 24h for safety, 72h for ordinary. Computed in epoch seconds
  -- (86400 = 24h, 259200 = 72h) because `timestamptz + interval` is STABLE, not
  -- IMMUTABLE (day/month intervals are timezone-sensitive), and a generated
  -- column requires an immutable expression. Epoch arithmetic is immutable and
  -- fixes the exact instant, identical to a fixed-hour interval add.
  due_at                timestamptz GENERATED ALWAYS AS (
    to_timestamp(
      extract(epoch from (filed_at - '1970-01-01 00:00:00+00'::timestamptz))
      + CASE WHEN class = 'safety' THEN 86400 ELSE 259200 END
    )
  ) STORED,
  acknowledged_at       timestamptz,
  resolved_at           timestamptz,
  resolver_account_id   uuid REFERENCES account (id),
  -- Shows the resolver's capacity when they have a membership (null for a
  -- platform actor resolving without one).
  resolver_membership_id uuid REFERENCES membership (id),
  action_taken          moderation_action,
  escalated_at          timestamptz,
  escalated_to          uuid REFERENCES account (id),
  note                  text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- The open queue, ordered by the SLA deadline. Partial so it indexes only the
-- unresolved reports the sweeper and the moderator queue actually scan.
CREATE INDEX moderation_report_open_due_idx
  ON moderation_report (due_at) WHERE resolved_at IS NULL;
-- Queue reads by chapter also filter on the open set.
CREATE INDEX moderation_report_chapter_idx ON moderation_report (chapter_id, filed_at);

-- --- Mechanism A grants (0002) ------------------------------------------
-- The 0002 `GRANT ... ON ALL TABLES` bound only the tables that existed then, so
-- this new table needs its own grant. The application role gets full DML; the
-- analytics read role is deliberately NOT granted (the default-deny stance the
-- other sensitive tables use) — a missing grant is the guarantee it cannot read
-- reports (which name minors and quote their content) directly.
GRANT SELECT, INSERT, UPDATE, DELETE ON moderation_report TO curiolab_app;
