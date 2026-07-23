-- =========================================================================
-- 0018_rls.sql — Mechanism B: per-request ROW-LEVEL SECURITY on the highest
-- -risk tables (01-stack.md "Two database access-control mechanisms";
-- 03-authorization.md "the database floor beneath can"; decision-log.md, the
-- A/B distinction). Milestone 4.1.
--
-- Mechanism A (0002) is role/credential separation: a restricted login lacks
-- the GRANT. Mechanism B is defense-in-depth ON TOP of that: even a connection
-- that HOLDS the grant sees only the rows its caller may see, so a forgotten
-- application-layer filter returns nothing across a boundary rather than
-- leaking. The policies filter by the caller's identity/chapter, activated by a
-- transaction-local variable — the per-request `SET LOCAL` pattern.
--
-- --- How this ships WITHOUT breaking the existing app path ------------------
-- The 692 pre-existing tests connect as the owner (superuser) or `curiolab_app`
-- and expect UNFILTERED reads. RLS is therefore built and PROVEN against a NEW
-- restricted role, `curiolab_rls`, which is the ONLY role subject to these
-- policies. The pre-existing app/read roles are given BYPASSRLS so their
-- behaviour is byte-for-byte unchanged; the owner is a superuser and bypasses
-- RLS inherently. RLS is ENABLE (not FORCE), so the table owner also bypasses.
--
-- --- REMAINING GO-LIVE WIRING (explicitly OUT OF SCOPE for M4.1) ------------
-- Activating RLS on the MAIN application connection means (a) connecting the app
-- as `curiolab_rls` (dropping its BYPASSRLS) and (b) threading a per-request
-- `withRlsContext({ accountId, isPlatform })` (packages/runtime/src/rls.ts)
-- through EVERY service read so each read runs inside a transaction that sets the
-- two GUCs below. That is a broad refactor of every service in packages/app and
-- is deferred. Until then these policies are dormant on the app path (BYPASSRLS)
-- and live only for `curiolab_rls`, where test/rls.test.ts proves the filtering.
--
-- --- The two transaction-local settings the policies key on -----------------
--   app.current_account_id  (uuid)       — the acting account
--   app.actor_is_platform   ('on'/'off') — a platform actor sees ALL rows
-- When unset, the helpers below yield NULL / false, so every predicate is false
-- and the policy DENIES (fail-closed). That is safe precisely because only
-- `curiolab_rls` is subject; the app path bypasses.
--
-- Passwords here are throwaway fixtures for the embedded test database only.
-- =========================================================================

-- --- The restricted role -------------------------------------------------
-- LOGIN, and NO BYPASSRLS: this is the role the policies actually bite.
CREATE ROLE curiolab_rls LOGIN PASSWORD 'rls_pw' NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO curiolab_rls;

-- The same table DML as curiolab_app on the high-risk tables (the append-only
-- ledgers keep their UPDATE/DELETE revoked, mirroring 0002 — RLS is a read
-- filter, not a replacement for the ledger guarantee).
GRANT SELECT, INSERT, UPDATE, DELETE
  ON enrollment_record, consent, guardianship, membership, audit_entry
  TO curiolab_rls;
REVOKE UPDATE, DELETE ON consent FROM curiolab_rls;
REVOKE UPDATE, DELETE ON audit_entry FROM curiolab_rls;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO curiolab_rls;

-- --- Keep every pre-existing connection unaffected -----------------------
-- The app role and the analytics read role both predate RLS and are expected to
-- read exactly as before; BYPASSRLS makes that guarantee explicit and total, so
-- the regression suite (which connects as these roles) is untouched. The owner
-- is the cluster superuser and bypasses RLS inherently, so it needs no change.
ALTER ROLE curiolab_app BYPASSRLS;
ALTER ROLE curiolab_analytics BYPASSRLS;

-- --- Predicate helper functions (documented, SQL) ------------------------
-- current_setting(..., true) returns NULL for an unset GUC (the `true` suppresses
-- the "unrecognized configuration parameter" error), mirroring the GUC pattern in
-- 0006/0009. NULLIF('', ...) tolerates an empty string as "unset".

-- The acting account, or NULL when unset (=> every id comparison is NULL => deny).
CREATE FUNCTION rls_current_account() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_account_id', true), '')::uuid;
$$;

-- True only inside a transaction that set app.actor_is_platform = 'on'.
CREATE FUNCTION rls_actor_is_platform() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.actor_is_platform', true), 'off') = 'on';
$$;

-- The set-returning helpers below must read membership/guardianship UNFILTERED to
-- decide visibility, so they are SECURITY DEFINER (owned by the migration's
-- superuser, which bypasses RLS). Without this a policy that queried membership
-- would itself be RLS-filtered, breaking the predicate. search_path is pinned for
-- SECURITY DEFINER safety. A membership is "active" when status = 'active' and,
-- if a window is present, current_date is within it — evaluated at query time,
-- mirroring can()'s in-force rule (03-authorization.md) and tolerating the
-- null-window shape the fixtures/services use.

-- Chapters where `acct` holds ANY active membership (used by membership: a member
-- sees co-members of their own chapter).
CREATE FUNCTION rls_active_chapter_ids(acct uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.chapter_id FROM membership m
  WHERE m.account_id = acct
    AND m.status = 'active'
    AND (m.active_from IS NULL OR m.active_from <= current_date)
    AND (m.active_until IS NULL OR current_date < m.active_until);
$$;

-- Chapters where `acct` holds an active STAFF membership (any non-student,
-- non-alumni capacity — the teaching/staff roles), used by the consent /
-- enrollment / guardianship policies' chapter clause.
CREATE FUNCTION rls_staff_chapter_ids(acct uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.chapter_id FROM membership m
  WHERE m.account_id = acct
    AND m.status = 'active'
    AND m.role NOT IN ('student', 'alumni')
    AND (m.active_from IS NULL OR m.active_from <= current_date)
    AND (m.active_until IS NULL OR current_date < m.active_until);
$$;

-- Student accounts that `acct` actively (verified) guardians.
CREATE FUNCTION rls_guardianed_children(acct uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT g.student_account_id FROM guardianship g
  WHERE g.guardian_account_id = acct
    AND g.status = 'verified';
$$;

-- Accounts that are members of any chapter where `acct` holds an active staff
-- membership — i.e. the learners a staff member is responsible for. Used to scope
-- consent / guardianship (which carry no chapter_id of their own) by chapter.
CREATE FUNCTION rls_accounts_in_staff_chapters(acct uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT m.account_id FROM membership m
  WHERE m.chapter_id IN (SELECT rls_staff_chapter_ids(acct));
$$;

-- --- Enable RLS + policies on the highest-risk tables --------------------
-- ENABLE (not FORCE): owner/superuser still bypass; BYPASSRLS roles bypass; only
-- curiolab_rls is subject. One permissive FOR ALL policy per table — its USING
-- expression governs which rows are visible and (as the implicit WITH CHECK) which
-- a write may add, so the boundary holds on reads AND writes for the restricted
-- role.

-- membership: platform sees all; else own row, or a co-member of one of the
-- actor's own active chapters (mirrors can()'s chapter scope).
ALTER TABLE membership ENABLE ROW LEVEL SECURITY;
CREATE POLICY membership_rls ON membership FOR ALL
  USING (
    rls_actor_is_platform()
    OR account_id = rls_current_account()
    OR chapter_id IN (SELECT rls_active_chapter_ids(rls_current_account()))
  );

-- consent: platform sees all; else the actor's OWN consent, a guardianed child's,
-- or a learner in a chapter where the actor is staff. (consent carries no
-- chapter_id, so the staff clause resolves through membership.)
ALTER TABLE consent ENABLE ROW LEVEL SECURITY;
CREATE POLICY consent_rls ON consent FOR ALL
  USING (
    rls_actor_is_platform()
    OR student_account_id = rls_current_account()
    OR student_account_id IN (SELECT rls_guardianed_children(rls_current_account()))
    OR student_account_id IN (SELECT rls_accounts_in_staff_chapters(rls_current_account()))
  );

-- enrollment_record: same shape, but it HAS a chapter_id, so the staff clause
-- keys on it directly.
ALTER TABLE enrollment_record ENABLE ROW LEVEL SECURITY;
CREATE POLICY enrollment_record_rls ON enrollment_record FOR ALL
  USING (
    rls_actor_is_platform()
    OR student_account_id = rls_current_account()
    OR student_account_id IN (SELECT rls_guardianed_children(rls_current_account()))
    OR chapter_id IN (SELECT rls_staff_chapter_ids(rls_current_account()))
  );

-- guardianship: platform sees all; else an edge naming the actor (as guardian OR
-- as the student), an edge to a guardianed child, or a learner in a chapter where
-- the actor is staff.
ALTER TABLE guardianship ENABLE ROW LEVEL SECURITY;
CREATE POLICY guardianship_rls ON guardianship FOR ALL
  USING (
    rls_actor_is_platform()
    OR guardian_account_id = rls_current_account()
    OR student_account_id = rls_current_account()
    OR student_account_id IN (SELECT rls_guardianed_children(rls_current_account()))
    OR student_account_id IN (SELECT rls_accounts_in_staff_chapters(rls_current_account()))
  );

-- audit_entry (the optional highest-risk table): platform sees all; else a row the
-- actor acted on (as the acting or the real actor behind an impersonation), or a
-- row in a chapter where the actor is staff.
ALTER TABLE audit_entry ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_entry_rls ON audit_entry FOR ALL
  USING (
    rls_actor_is_platform()
    OR actor_account_id = rls_current_account()
    OR real_actor_account_id = rls_current_account()
    OR chapter_id IN (SELECT rls_staff_chapter_ids(rls_current_account()))
  );
