-- =========================================================================
-- 0001_guarantees.sql — the compliance guarantees that must live in the
-- database (02-data-model.md, decision-log.md). Each has a red-before-green
-- test in test/db-guarantees.test.ts. These are triggers, checks, a partial
-- unique index, a NOT NULL tightening, and PL/pgSQL — deliberately NOT
-- application code, because application code can be bypassed.
-- =========================================================================

-- --- Decision-4: student DOB must come from the enrollment record ---------
-- Any account with an ACTIVE student membership must carry
-- dob_provenance = 'enrollment_record' and a non-null dob_source_ref.
CREATE FUNCTION enforce_student_dob_provenance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE prov dob_provenance; sref uuid;
BEGIN
  IF NEW.role = 'student' AND NEW.status = 'active' THEN
    SELECT dob_provenance, dob_source_ref INTO prov, sref
      FROM account WHERE id = NEW.account_id;
    IF prov IS DISTINCT FROM 'enrollment_record' OR sref IS NULL THEN
      RAISE EXCEPTION
        'active student membership requires account dob_provenance=enrollment_record with a dob_source_ref (account %)',
        NEW.account_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER membership_student_dob
  BEFORE INSERT OR UPDATE ON membership
  FOR EACH ROW EXECUTE FUNCTION enforce_student_dob_provenance();

-- --- Form-sourced consent checks -----------------------------------------
-- A data_collection row sourced from a signed form must name the document.
ALTER TABLE consent ADD CONSTRAINT consent_data_collection_source_ref
  CHECK (NOT (type = 'data_collection' AND source = 'signed_form' AND source_ref IS NULL));
-- external_publication is never blanket: it must name the scoped item.
ALTER TABLE consent ADD CONSTRAINT consent_external_pub_scope_ref
  CHECK (type <> 'external_publication' OR scope_ref IS NOT NULL);
-- effective_at is the guardian's decision instant; it may not be in the future.
CREATE FUNCTION enforce_consent_effective_not_future() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.effective_at > now() THEN
    RAISE EXCEPTION 'consent effective_at may not be in the future (%)', NEW.effective_at
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER consent_effective_not_future
  BEFORE INSERT ON consent
  FOR EACH ROW EXECUTE FUNCTION enforce_consent_effective_not_future();

-- --- Single active membership --------------------------------------------
CREATE UNIQUE INDEX membership_single_active
  ON membership (account_id, chapter_id, role)
  WHERE status = 'active';

-- --- Membership shape (covers the alumni shape guarantee) -----------------
ALTER TABLE membership ADD CONSTRAINT membership_tier_student_only
  CHECK (current_tier IS NULL OR role = 'student');
ALTER TABLE membership ADD CONSTRAINT membership_pod_scope
  CHECK (pod_id IS NULL OR role IN ('student', 'junior_mentor'));

-- --- Evidence-backed tier + coupling F ------------------------------------
ALTER TABLE tier_transition ALTER COLUMN evidence_ref SET NOT NULL;
-- An inserted transition is the authority; it syncs the membership's tier.
CREATE FUNCTION sync_membership_tier() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE membership SET current_tier = NEW.to_tier WHERE id = NEW.membership_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER tier_transition_sync
  AFTER INSERT ON tier_transition
  FOR EACH ROW EXECUTE FUNCTION sync_membership_tier();

-- --- Append-only enforcement (trigger backstop) ---------------------------
-- The role-level REVOKE lives in 0002; this trigger blocks even a privileged
-- role, so the ledger is tamper-evident regardless of who holds the grant.
CREATE FUNCTION reject_append_only_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER consent_append_only
  BEFORE UPDATE OR DELETE ON consent
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER audit_entry_append_only
  BEFORE UPDATE OR DELETE ON audit_entry
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

-- --- consent_current maintenance ------------------------------------------
-- Maintained in the same transaction as each consent insert. Current state is
-- the row with the latest effective_at (the guardian's most recent decision),
-- with seq (filing order) breaking ties only for identical effective_at.
CREATE FUNCTION maintain_consent_current() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE winner consent%ROWTYPE;
BEGIN
  SELECT * INTO winner FROM consent
    WHERE student_account_id = NEW.student_account_id AND type = NEW.type
    ORDER BY effective_at DESC, seq DESC
    LIMIT 1;

  INSERT INTO consent_current (
    student_account_id, type, consent_id, active, action,
    effective_at, seq, source_ref, scope_ref, updated_at
  ) VALUES (
    winner.student_account_id, winner.type, winner.id, winner.action = 'grant',
    winner.action, winner.effective_at, winner.seq, winner.source_ref, winner.scope_ref, now()
  )
  ON CONFLICT (student_account_id, type) DO UPDATE SET
    consent_id   = EXCLUDED.consent_id,
    active       = EXCLUDED.active,
    action       = EXCLUDED.action,
    effective_at = EXCLUDED.effective_at,
    seq          = EXCLUDED.seq,
    source_ref   = EXCLUDED.source_ref,
    scope_ref    = EXCLUDED.scope_ref,
    updated_at   = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER consent_maintain_current
  AFTER INSERT ON consent
  FOR EACH ROW EXECUTE FUNCTION maintain_consent_current();

-- --- Impersonation of a minor is read-only --------------------------------
CREATE FUNCTION enforce_minor_impersonation_readonly() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE dob date;
BEGIN
  IF NEW.impersonated_account_id IS NOT NULL AND NEW.mode = 'full' THEN
    SELECT date_of_birth INTO dob FROM account WHERE id = NEW.impersonated_account_id;
    IF dob > (current_date - INTERVAL '18 years') THEN
      RAISE EXCEPTION 'impersonation of a minor must be read_only (account %)',
        NEW.impersonated_account_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER session_minor_impersonation
  BEFORE INSERT OR UPDATE ON session
  FOR EACH ROW EXECUTE FUNCTION enforce_minor_impersonation_readonly();

-- --- Guardian invite must equal the bound enrollment email ----------------
CREATE FUNCTION enforce_guardian_invite_email() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE gemail citext;
BEGIN
  IF NEW.kind = 'guardian' THEN
    IF NEW.enrollment_record_id IS NULL THEN
      RAISE EXCEPTION 'a guardian invite must bind an enrollment record'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT a.guardian_email INTO gemail
      FROM enrollment_record e
      JOIN application a ON a.id = e.application_id
      WHERE e.id = NEW.enrollment_record_id;
    IF gemail IS DISTINCT FROM NEW.target_email THEN
      RAISE EXCEPTION
        'guardian invite target_email must equal the bound enrollment guardian email'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER invite_guardian_email
  BEFORE INSERT ON invite
  FOR EACH ROW EXECUTE FUNCTION enforce_guardian_invite_email();
