-- =========================================================================
-- 0037_student_notification_email.sql — the STUDENT NOTIFICATION-EMAIL column +
-- the under-13 age-floor trigger. ADDITIVE. Built DARK behind
-- STUDENT_NOTIFICATION_EMAIL_ENABLED (default false), COUNSEL-GATED: enabling
-- makes a minor DIRECTLY CONTACTABLE, reversing the platform's standing "a
-- student is not directly contactable" posture. The DB mechanism is built +
-- tested against SYNTHETIC data now; nothing sets a notification_email or resolves
-- a student email target while the flag is off.
--
-- Depends on 0036 having committed the `student_notification_email` enum value
-- (the trigger's function body references it; separated per PostgreSQL 55P04).
--
-- --- account.notification_email (an outbound-only address, NOT an identity) --
-- A nullable `notification_email citext`, DISTINCT from the login `email`. A minor
-- keeps `username` as their login and `email` NULL; `notification_email` is an
-- optional, outbound-only address to which notifications may ALSO be sent. It does
-- NOT participate in the account_identity_one_of (email-XOR-username) constraint —
-- a minor with a notification_email still has `email` NULL and `username` set — and
-- it is NOT a unique login index (two records may share one outbound address). It
-- is HIDDEN in the backend: no director/staff/other-user read selects it (only the
-- student themselves and a verified guardian may see it, if a read is ever added).
ALTER TABLE account
  ADD COLUMN notification_email citext;

-- --- the under-13 student_notification_email age floor (DB backstop) --------
-- A student_notification_email GRANT row (revoked_at IS NULL) is REFUSED when the
-- subject is UNDER 13 at granted_at — COPPA bites hardest under 13, so v1 is 13+
-- only. Age is computed from the subject's DOB. The floor applies to GRANT rows
-- only; a revocation/lapse row (revoked_at set) is EXEMPT — the same shape as the
-- under-13 public_publication and mentor_dm floors (0024 / 0030). A database floor,
-- not application code, because application code can be bypassed; the service
-- (ConsentGrantService.captureGrant) is the primary, friendlier gate.
CREATE FUNCTION enforce_under13_student_notification_email() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE dob date;
BEGIN
  IF NEW.grant_type = 'student_notification_email' AND NEW.revoked_at IS NULL THEN
    SELECT date_of_birth INTO dob FROM account WHERE id = NEW.subject_student_account_id;
    -- under 13 iff born strictly after (granted_at - 13 years)
    IF dob > (NEW.granted_at::date - INTERVAL '13 years') THEN
      RAISE EXCEPTION
        'student_notification_email consent for a subject under 13 is refused (subject %)',
        NEW.subject_student_account_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER consent_grant_under13_student_notification_email
  BEFORE INSERT ON consent_grant
  FOR EACH ROW EXECUTE FUNCTION enforce_under13_student_notification_email();
