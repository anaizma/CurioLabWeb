-- =========================================================================
-- 0016_newsletter.sql — Milestone 3.5: the newsletter_issue + newsletter_item
-- schema. (02-data-model.md "Newsletter and money" — newsletter_issue — and the
-- 04-state-machines newsletter_issue lifecycle
-- draft -> in_review -> scheduled -> published -> archived, plus `blocked`.)
--
-- The chapter (or platform-wide) newsletter and its items. A `newsletter_item`
-- with a non-null `author_student_account_id` is a STUDENT-authored item — the
-- representation the publish gate (coupling E) needs, so it can require that
-- student's `external_publication` consent scoped to the ISSUE, one requirement
-- per student item (the same shape as project.publish_public). This migration is
-- additive and structural — two tables, one enum, the by-issue item index, and
-- the Mechanism-A grants (the app role gets DML; the analytics read role is
-- deliberately NOT granted — a newsletter quotes and names minors, so it takes
-- the same default-deny stance as the other sensitive tables).
--
-- Scope note: no service, HTTP route, or subscribers/webhooks here (that is
-- M3.6/M3.7). "Only `published` is readable without a session; archived is
-- staff-read only" (02-data-model.md) are READ-side policies enforced in the app
-- layer, not the schema. Coupling E (publish re-checks each student item's
-- consent atomically; the send is enqueued after commit) and the
-- consent-driven unpublish+redaction (extends coupling C2) are the
-- NewsletterService's concern; this migration lays only the schema and its
-- structural guarantees.
--
-- Guarantees with a red-before-green test in test/newsletter-schema.test.ts:
--   * newsletter_issue.status defaults 'draft'; invalid enum values rejected;
--     a NULL chapter_id (platform-wide) issue is accepted; chapter_id and
--     published_by foreign keys resolve;
--   * newsletter_item.issue_id and author_student_account_id foreign keys
--     resolve; author_student_account_id NULL (a staff-written item) is accepted;
--   * the app role may DML; the analytics role is denied SELECT.
-- CURIOLAB_MIGRATE_UPTO=0015 witnesses the red state (the relations are absent).
-- =========================================================================

-- --- enum (mirror packages/db/src/enums.ts) ------------------------------
CREATE TYPE newsletter_issue_status AS ENUM (
  'draft', 'in_review', 'scheduled', 'published', 'archived', 'blocked'
);

-- --- newsletter_issue ----------------------------------------------------
-- chapter_id NULL = platform-wide (02-data-model.md). scheduled_for records the
-- send time set at `schedule`; published_by / published_at are stamped at
-- publish. Only `published` is readable without a session and `archived` is
-- staff-read only — enforced in the app layer, not here.
CREATE TABLE newsletter_issue (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id    uuid REFERENCES chapter (id),
  title         text NOT NULL,
  body          text NOT NULL,
  status        newsletter_issue_status NOT NULL DEFAULT 'draft',
  scheduled_for timestamptz,
  published_by  uuid REFERENCES account (id),
  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- --- newsletter_item -----------------------------------------------------
-- One block of an issue. author_student_account_id NULL = a staff-written item;
-- non-null = a student-authored item, whose external_publication consent (scoped
-- to the issue) the publish gate requires. ref is the project/post this item
-- points at (polymorphic, no FK).
CREATE TABLE newsletter_item (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id                  uuid NOT NULL REFERENCES newsletter_issue (id),
  author_student_account_id uuid REFERENCES account (id),
  ref                       uuid,
  body                      text NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now()
);
-- The publish gate and the issue render both read the items of one issue.
CREATE INDEX newsletter_item_issue_idx ON newsletter_item (issue_id);

-- --- Mechanism A grants (0002) ------------------------------------------
-- The 0002 `GRANT ... ON ALL TABLES` bound only the tables that existed then, so
-- these new tables need their own grant. The application role gets full DML; the
-- analytics read role is deliberately NOT granted (the default-deny stance the
-- other sensitive tables use) — a newsletter names and quotes minors.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON newsletter_issue, newsletter_item
  TO curiolab_app;
