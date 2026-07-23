-- =========================================================================
-- 0013_feed_content.sql — Milestone 2.1: the feed content schema (The Lab).
-- (docs/platform/plans/milestone-2.md §M2.1; 02-data-model.md "Community
-- content".)
--
-- The internal community feed's content spine: post, comment, reaction, and the
-- append-only timeline_entry. Authorship is by membership so a row carries the
-- author's capacity and scope. This migration is additive and structural — it
-- adds four tables, their enums, the reaction uniqueness index, sensible feed
-- indexes, the timeline_entry append-only discipline (the shared trigger backstop
-- plus the role-level REVOKE, mirroring consent/audit_entry), and the
-- Mechanism-A grants for the application role (analytics left ungranted).
--
-- Scope note: no service, HTTP route, moderation_report (M2.4), or project/media
-- (Milestone 3) here — only the content schema and its DB guarantees.
--
-- Guarantees with a red-before-green test in test/feed-content.test.ts:
--   * reaction uniqueness on (target_type, target_id, membership_id, kind);
--   * timeline_entry append-only (owner UPDATE/DELETE raise; the app role's
--     UPDATE/DELETE are revoked);
--   * post enum/nullability (invalid type/status rejected; status defaults
--     'published'; system_generated defaults false; FKs resolve).
-- CURIOLAB_MIGRATE_UPTO=0012 witnesses the red state (the relations do not exist).
-- =========================================================================

-- --- enums (mirror packages/db/src/enums.ts) -----------------------------
CREATE TYPE post_type AS ENUM (
  'wip', 'finished_project', 'question', 'session_recap', 'milestone'
);
-- One lifecycle for both post and comment ("Same machine as post",
-- 02-data-model.md): published -> hidden -> removed.
CREATE TYPE content_status AS ENUM ('published', 'hidden', 'removed');
-- What a reaction points at. target_id is a polymorphic reference discriminated
-- by this type, so it carries no foreign key.
CREATE TYPE reaction_target_type AS ENUM ('post', 'comment');

-- --- post ----------------------------------------------------------------
CREATE TABLE post (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id           uuid NOT NULL REFERENCES chapter (id),
  pod_id               uuid REFERENCES pod (id),
  author_membership_id uuid NOT NULL REFERENCES membership (id),
  type                 post_type NOT NULL,
  body                 text NOT NULL,
  status               content_status NOT NULL DEFAULT 'published',
  system_generated     boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX post_chapter_created_idx ON post (chapter_id, created_at);
CREATE INDEX post_pod_created_idx ON post (pod_id, created_at);

-- --- comment -------------------------------------------------------------
CREATE TABLE comment (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id              uuid NOT NULL REFERENCES post (id),
  author_membership_id uuid NOT NULL REFERENCES membership (id),
  body                 text NOT NULL,
  status               content_status NOT NULL DEFAULT 'published',
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comment_post_created_idx ON comment (post_id, created_at);

-- --- reaction ------------------------------------------------------------
CREATE TABLE reaction (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type   reaction_target_type NOT NULL,
  target_id     uuid NOT NULL,
  membership_id uuid NOT NULL REFERENCES membership (id),
  kind          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- One reaction of a given kind per member per target.
CREATE UNIQUE INDEX reaction_unique
  ON reaction (target_type, target_id, membership_id, kind);

-- --- timeline_entry (append-only) ----------------------------------------
-- The profile spine and the source of milestone posts. Append-only: the shared
-- reject_append_only_mutation() trigger (0001) is the backstop, and the
-- role-level REVOKE below is the belt, exactly as on consent/audit_entry.
CREATE TABLE timeline_entry (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES account (id),
  kind        text NOT NULL,
  occurred_at timestamptz NOT NULL,
  ref         uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX timeline_entry_account_occurred_idx ON timeline_entry (account_id, occurred_at);
CREATE TRIGGER timeline_entry_append_only
  BEFORE UPDATE OR DELETE ON timeline_entry
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

-- --- Mechanism A grants (0002) ------------------------------------------
-- The 0002 `GRANT ... ON ALL TABLES` bound only the tables that existed then, so
-- these new tables need their own grant. The application role gets full DML;
-- timeline_entry is an append-only ledger, so its UPDATE/DELETE are revoked at
-- the role level (belt to the trigger's braces) as on consent/audit_entry. The
-- analytics read role is deliberately NOT granted (the default-deny stance the
-- other sensitive tables use): a missing grant is the guarantee it cannot read
-- minors' feed content directly.
GRANT SELECT, INSERT, UPDATE, DELETE ON post, comment, reaction, timeline_entry TO curiolab_app;
REVOKE UPDATE, DELETE ON timeline_entry FROM curiolab_app;
