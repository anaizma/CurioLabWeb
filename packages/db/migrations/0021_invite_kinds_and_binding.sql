-- =========================================================================
-- 0021_invite_kinds_and_binding.sql — Admin/Director backend, Phase P2 (§1 +
-- §4). ADDITIVE: two new enum values, one new column, one new table. Nothing is
-- rewritten and no applied migration is edited (the migration guarantee — the
-- ordered files are append-only, each database guarantee has a red-before-green
-- witness in test/, and CURIOLAB_MIGRATE_UPTO=0020 witnesses the red state).
--
-- --- §1 invite kinds: director + admin -----------------------------------
-- The account-origination system grows two privileged invite kinds. `admin`
-- (a platform_admin) and `director` (a chapter_director) join the existing
-- guardian / student / mentor / staff. Per-kind ISSUING AUTHORITY is enforced in
-- the app layer (InviteService + the member.invite_admin / member.invite_director
-- capabilities); the enum is only the value floor.
--
-- ALTER TYPE ... ADD VALUE runs fine inside the migration's implicit transaction
-- on PostgreSQL 12+ (the only remaining restriction — that the new value cannot
-- be USED in the same transaction — does not apply here: this file never inserts
-- a row of the new kind; the schema tests do, in their own later transactions).
-- IF NOT EXISTS makes the statement idempotent.
--
-- --- §4 token hardening: bind {email, kind, chapter} at redemption --------
-- invite already carries target_email (the email binding) and kind. The chapter
-- binding was, until now, derivable ONLY through the enrollment_record join —
-- which the guardian/student invites carry but the adult invites
-- (mentor/staff/director/admin) do NOT. bound_chapter_id records the chapter the
-- invite is issued into directly on the row, so acceptInvite/accept-student can
-- verify the presented token resolves to an invite whose bound
-- {email, kind, chapter} match the acceptance context and refuse (opaque
-- invalid_token) on mismatch. Nullable + backfilled from the enrollment record
-- for the pre-existing guardian/student rows; new rows always set it at issue.
--
-- --- §1 two-person director approval: director_invite_request -------------
-- A director invite is NOT minted by a single director. A director INITIATES a
-- pending request; a SECOND, DISTINCT director APPROVES it; only on approval is
-- the token minted (invite_id is stamped then). This table is that explicit,
-- auditable record: BOTH actor account ids (initiated_by, approved_by) and BOTH
-- timestamps (initiated_at, approved_at) are recorded, and a DB CHECK enforces
-- that the approver is distinct from the initiator — the "single director acting
-- alone cannot mint a director invite" rule, floored at the database, not only in
-- the service (defence in depth, matching the guardian-invite-email trigger).
-- =========================================================================

-- --- §1 enum values (mirror packages/db/src/enums.ts) --------------------
ALTER TYPE invite_kind ADD VALUE IF NOT EXISTS 'director';
ALTER TYPE invite_kind ADD VALUE IF NOT EXISTS 'admin';

-- --- §4 chapter binding on invite ----------------------------------------
ALTER TABLE invite ADD COLUMN bound_chapter_id uuid REFERENCES chapter (id);
-- Backfill the pre-existing guardian/student rows from their enrollment record so
-- the chapter binding is complete for every historical invite; new rows set it at
-- issue time (InviteService). Left nullable: a legacy row without an enrollment
-- (none in practice) simply carries null and falls back to the enrollment join.
UPDATE invite i
   SET bound_chapter_id = e.chapter_id
  FROM enrollment_record e
 WHERE e.id = i.enrollment_record_id
   AND i.bound_chapter_id IS NULL;
CREATE INDEX invite_bound_chapter_idx ON invite (bound_chapter_id);

-- --- §1 the two-person director-invite approval record -------------------
CREATE TABLE director_invite_request (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id    uuid NOT NULL REFERENCES chapter (id),
  -- The email the eventual director invite is bound to (citext: case-insensitive,
  -- matching account.email / invite.target_email).
  target_email  citext NOT NULL,
  -- The first director. Records who opened the request and when.
  initiated_by  uuid NOT NULL REFERENCES account (id),
  initiated_at  timestamptz NOT NULL DEFAULT now(),
  -- The second, DISTINCT director. Null until approval; stamped with the approver
  -- and the approval instant when the token is minted.
  approved_by   uuid REFERENCES account (id),
  approved_at   timestamptz,
  -- The invite minted on approval (null while pending). The token itself lives
  -- only on the invite row (hash), never here.
  invite_id     uuid REFERENCES invite (id),
  status        text NOT NULL DEFAULT 'pending',
  -- Decision-time expiry (adult 72h), evaluated at approval against now().
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- The floor beneath the service: a single director cannot be both the initiator
  -- and the approver. A pending row (approved_by null) passes; an approved row
  -- must name a DISTINCT approver.
  CONSTRAINT director_invite_request_distinct_approver
    CHECK (approved_by IS NULL OR approved_by <> initiated_by),
  CONSTRAINT director_invite_request_status
    CHECK (status IN ('pending', 'approved'))
);

CREATE INDEX director_invite_request_chapter_idx ON director_invite_request (chapter_id);
CREATE INDEX director_invite_request_initiator_idx ON director_invite_request (initiated_by);

-- --- Mechanism A grants (0002) -------------------------------------------
-- The 0002 GRANT bound only the tables that existed then; this new table needs
-- its own grant. The application role gets full DML (it initiates, approves, and
-- stamps the minted invite_id). The analytics read role is deliberately NOT
-- granted — the row carries a target_email and backs privileged account
-- origination, so a read login cannot reach it directly (default-deny, the same
-- stance credential_token takes).
GRANT SELECT, INSERT, UPDATE, DELETE ON director_invite_request TO curiolab_app;
