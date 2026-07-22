-- =========================================================================
-- 0002_roles.sql — Mechanism A: role and credential separation.
--
-- Two application-facing Postgres roles with different table grants. The
-- guarantee that a product lead cannot read a sensitive table directly is a
-- MISSING GRANT, not a human refraining (07-test-plan.md, "coverage
-- boundaries"). Milestone 3 extends this exact pattern to payment_ref and
-- scholarship (the financial/HR-style tables); the pattern is demonstrated
-- here on enrollment_record and guardianship, which exist in Milestone 0.
--
-- Two roles:
--   curiolab_app       — the application role. Full DML, EXCEPT UPDATE/DELETE
--                        on the append-only ledgers (consent, audit_entry),
--                        which are revoked here in addition to the trigger
--                        backstop in 0001.
--   curiolab_analytics — a restricted read role. SELECT on most tables but
--                        NOT on enrollment_record or guardianship.
--
-- Passwords here are throwaway fixtures for the embedded test database only.
-- =========================================================================

CREATE ROLE curiolab_app LOGIN PASSWORD 'app_pw';
CREATE ROLE curiolab_analytics LOGIN PASSWORD 'analytics_pw';

GRANT USAGE ON SCHEMA public TO curiolab_app, curiolab_analytics;

-- --- Application role -----------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO curiolab_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO curiolab_app;
-- Append-only ledgers: revoke mutation at the role level (belt to the
-- trigger's braces). The app can append and read, never rewrite history.
REVOKE UPDATE, DELETE ON consent FROM curiolab_app;
REVOKE UPDATE, DELETE ON audit_entry FROM curiolab_app;

-- --- Restricted analytics role -------------------------------------------
GRANT SELECT ON ALL TABLES IN SCHEMA public TO curiolab_analytics;
-- Deny the sensitive tables. This is the testable form of "no direct reads
-- of learner enrollment or guardianship facts by an analytics/read login".
REVOKE SELECT ON enrollment_record FROM curiolab_analytics;
REVOKE SELECT ON guardianship FROM curiolab_analytics;
