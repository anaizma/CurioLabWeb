-- =========================================================================
-- 0015_project_media.sql — Milestone 3.1: project / media / profile /
-- verification schema. (02-data-model.md "Community content" — project,
-- project_media, media_depiction, profile_narrative — and "Moderation,
-- verification, deletion" — verification_token.)
--
-- The showcase spine: a chapter member's project, the media attached to it (or
-- to a feed post), the people a piece of media depicts, a member's profile
-- narrative, and the single-use verification token that backs a shared public
-- profile. This migration is additive and structural — five tables, their four
-- enums, the verification_token one-live-per-subject partial unique index and
-- token_hash uniqueness, the media_depiction composite primary key, sensible
-- indexes, and the Mechanism-A grants (the app role gets DML; the analytics
-- read role is deliberately NOT granted, the default-deny stance the other
-- sensitive tables use — verification_token especially, as it backs identity).
--
-- Scope note: no service, HTTP route, or newsletter tables here (those are the
-- newsletter phase and the M3 app layer). The couplings that live on these
-- tables — C1 (revoking photo_media flips depicting media to pending_review),
-- C2 (public_listed requires an active external_publication consent and reverts
-- to verified when revoked) — are consent-driven triggers deferred to their own
-- phase; this migration lays only the schema and its structural guarantees.
--
-- Guarantees with a red-before-green test in test/project-media-schema.test.ts:
--   * project.status defaults 'draft'; project_media.review_status defaults
--     'pending_review'; invalid enum values rejected; project FKs resolve;
--   * media_depiction composite PK (media_id, account_id) rejects duplicates,
--     admits two accounts on one media; invalid source rejected;
--   * profile_narrative.status defaults 'draft'; invalid status rejected;
--   * verification_token: at most one live (revoked_at IS NULL) token per
--     subject; token_hash globally unique; re-issue after revoke succeeds;
--   * the app role may DML; the analytics role is denied SELECT.
-- CURIOLAB_MIGRATE_UPTO=0014 witnesses the red state (the relations are absent).
-- =========================================================================

-- --- enums (mirror packages/db/src/enums.ts) -----------------------------
CREATE TYPE project_status AS ENUM ('draft', 'submitted', 'verified', 'public_listed');
CREATE TYPE media_review_status AS ENUM ('ok', 'pending_review', 'removed');
-- Who asserted a depiction. Only a mentor/staff confirmation authoritatively
-- clears an image (02-data-model.md); a student may attach their own work but
-- cannot authoritatively tag people.
CREATE TYPE media_source AS ENUM ('student', 'mentor', 'staff');
-- The narrative lifecycle: a minor's edit lands in pending_review and is not
-- publicly reachable until narrative.review clears it. Distinct from
-- content_status (post/comment) — it carries a pending_review state.
CREATE TYPE narrative_status AS ENUM ('draft', 'pending_review', 'published', 'removed');

-- --- project -------------------------------------------------------------
CREATE TABLE project (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id          uuid NOT NULL REFERENCES chapter (id),
  -- Ownership is by membership so a row carries the owner's capacity and scope.
  owner_membership_id uuid NOT NULL REFERENCES membership (id),
  title               text NOT NULL,
  summary             text,
  status              project_status NOT NULL DEFAULT 'draft',
  -- Who verified the project, and when (null until verified). References an
  -- account (a staff/mentor actor), not a membership.
  verified_by         uuid REFERENCES account (id),
  verified_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
-- The chapter showcase reads by (chapter, status); the owner's profile reads by
-- owning membership.
CREATE INDEX project_chapter_status_idx ON project (chapter_id, status);
CREATE INDEX project_owner_idx ON project (owner_membership_id);

-- --- project_media -------------------------------------------------------
-- Media hangs off either a project or a feed post (exactly which is an
-- application concern; both fks are nullable here). storage_ref points at the
-- object store. Student uploads default review_status = 'pending_review'.
CREATE TABLE project_media (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid REFERENCES project (id),
  post_id       uuid REFERENCES post (id),
  storage_ref   uuid NOT NULL,
  review_status media_review_status NOT NULL DEFAULT 'pending_review',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_media_project_idx ON project_media (project_id);

-- --- media_depiction -----------------------------------------------------
-- The people a piece of media depicts. Composite PK (media_id, account_id): one
-- depiction row per (media, account). A source in ('mentor','staff') sets
-- confirmed_at to clear the image for photo_media-gated uses.
CREATE TABLE media_depiction (
  media_id     uuid NOT NULL REFERENCES project_media (id),
  account_id   uuid NOT NULL REFERENCES account (id),
  added_by     uuid NOT NULL REFERENCES account (id),
  source       media_source NOT NULL,
  confirmed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (media_id, account_id)
);

-- --- profile_narrative ---------------------------------------------------
-- A member's self-authored profile narrative. The student edits their own; a
-- guardian never authors; staff may remove/clear but never author.
CREATE TABLE profile_narrative (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES account (id),
  body       text NOT NULL,
  status     narrative_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX profile_narrative_account_idx ON profile_narrative (account_id);

-- --- verification_token --------------------------------------------------
-- The single-use token that backs a shared public profile. Append-only in
-- practice (regeneration is one insert plus one revoke) but not trigger-locked,
-- because revocation legitimately UPDATEs revoked_at. token_hash is the secret
-- and is globally unique; at most one LIVE token (revoked_at IS NULL) may exist
-- per subject, enforced by the partial unique index below.
CREATE TABLE verification_token (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_account_id uuid NOT NULL REFERENCES account (id),
  token_hash         text NOT NULL,
  issued_by          uuid NOT NULL REFERENCES account (id),
  issued_at          timestamptz NOT NULL DEFAULT now(),
  revoked_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
-- The secret is globally unique.
CREATE UNIQUE INDEX verification_token_hash_unique ON verification_token (token_hash);
-- At most one live token per subject; a revoked token no longer counts, so
-- re-issue is one insert after one revoke.
CREATE UNIQUE INDEX verification_token_one_live_per_subject
  ON verification_token (subject_account_id) WHERE revoked_at IS NULL;

-- --- Mechanism A grants (0002) ------------------------------------------
-- The 0002 `GRANT ... ON ALL TABLES` bound only the tables that existed then, so
-- these new tables need their own grant. The application role gets full DML; the
-- analytics read role is deliberately NOT granted (the default-deny stance the
-- other sensitive tables use). A missing grant is the guarantee analytics cannot
-- read these directly — verification_token especially, which backs identity, and
-- media/narratives which depict and quote minors.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON project, project_media, media_depiction, profile_narrative, verification_token
  TO curiolab_app;
