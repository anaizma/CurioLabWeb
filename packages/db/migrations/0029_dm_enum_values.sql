-- =========================================================================
-- 0029_dm_enum_values.sql -- mentor-student direct messaging (Phase 1), the two
-- new ENUM VALUES only. ADDITIVE. Built DARK behind MENTOR_DM_ENABLED (default
-- false) and COUNSEL-GATED (design Part A/B): adding these values authorizes
-- nothing; no real minor can be a party while the flag is off.
--
-- These are isolated in their OWN migration file (ahead of 0030, which builds the
-- tables/triggers that USE them) because `ALTER TYPE ... ADD VALUE` and a
-- statement that USES the new value cannot share a transaction (PostgreSQL 55P04).
-- Each migration file is applied as its own transaction, so the values are
-- committed here before 0030 references them. IF NOT EXISTS keeps it idempotent.
--
-- --- role: safety_officer (design C.1) -------------------------------------
-- A chapter-scoped INDEPENDENT safety officer principal -- NOT a mentor and NOT a
-- student in that chapter (the not-a-peer rule, floored by a trigger in 0030 and
-- enforced in the SafetyOfficerService). The pure @curiolab/core Role union +
-- ALL_ROLES already carry it; this is the database projection. Per-capability
-- authority (dm.oversee, safety_officer.assign) lives in the registry, not here.
--
-- --- consent_grant_type: mentor_dm (design C.3, C.10) ----------------------
-- A guardian's consent for a supervised mentor-student DM channel for their
-- child. Captured as a SIGNED FORM (a click is refused -- a DB trigger backstop in
-- 0030), expires at term end, independently revocable via the existing per-grant
-- revoke. A new grant type in the P6a consent grant-ledger; the capture/current/
-- revoke machinery is reused unchanged.
-- =========================================================================

ALTER TYPE role ADD VALUE IF NOT EXISTS 'safety_officer';
ALTER TYPE consent_grant_type ADD VALUE IF NOT EXISTS 'mentor_dm';
