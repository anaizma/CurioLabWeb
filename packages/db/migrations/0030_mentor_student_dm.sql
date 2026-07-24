-- =========================================================================
-- 0030_mentor_student_dm.sql -- mentor-student direct messaging (Phase 1), the
-- append-only ENCRYPTED thread store + the safety-officer not-a-peer floor + the
-- mentor_dm signed-form floor + the enable-precondition tables (design C.1, C.2,
-- C.3, C.11, Part D). ADDITIVE. Built DARK behind MENTOR_DM_ENABLED (default
-- false), COUNSEL-GATED (Part A/B). The DB mechanism is built + tested against
-- SYNTHETIC data now; NOTHING accepts a real send while the flag is off.
--
-- This is the HIGHEST-RISK surface in the platform (adult-to-minor messaging), so
-- the controls are floored at the DATABASE, not only in application code:
--   * dm_message.body is stored ENCRYPTED (an AES-256-GCM {v,iv,ct,tag} envelope
--     from packages/runtime/field-crypto.ts) -- NEVER plaintext at rest. A CHECK
--     requires the envelope keys, so a plaintext column cannot sneak in.
--   * dm_thread + dm_message are APPEND-ONLY (the shared reject_append_only_mutation()
--     trigger from 0001 + SELECT/INSERT-only role grants) -- no edit, no delete, by
--     anyone, ever (design C.4). A correction is a new message.
--   * mentor_dm consent REQUIRES a signed_form method + a non-null evidence
--     artifact (a click is REFUSED) -- a trigger backstop to the service check.
--   * a safety_officer membership and a mentor/teaching or student membership for
--     the SAME account in the SAME chapter are mutually exclusive (the not-a-peer
--     rule) -- a trigger backstop to the SafetyOfficerService check.
--
-- --- Guarantees with a red-before-green test (test/dm-schema.test.ts) --------
--   * dm_thread + dm_message exist; account/membership/chapter fks; the encrypted
--     body envelope CHECK; append-only (UPDATE/DELETE rejected) on BOTH;
--   * dm_thread_current derives last_message_at = max(sent_at) (created_at when
--     the thread has no messages yet);
--   * the mentor_dm signed_form floor (a click / missing artifact is REFUSED; a
--     signed_form + artifact accepted; a revocation row exempt);
--   * the safety_officer not-a-peer floor (a safety_officer + a mentor/student for
--     one account in one chapter is refused, both insert orders);
--   * dm_insurance_attestation + dm_chapter_switch exist (append-only);
--   * Mechanism-A grants: app SELECT/INSERT (not UPDATE/DELETE).
-- CURIOLAB_MIGRATE_UPTO=0029 witnesses the red state (the relations are absent).
-- =========================================================================

-- --- mentor_dm signed-form floor (design C.3) ------------------------------
-- A mentor_dm GRANT row (revoked_at IS NULL) requires the strong `signed_form`
-- method AND a non-null evidence_artifact_ref: the signed form is deliberate
-- friction that tests guardian engagement, a load-bearing control. A `click`, or
-- a signed_form with no artifact, is REFUSED. A revocation/lapse row (revoked_at
-- set, method 'click') is EXEMPT -- like the under-13 public_publication floor, the
-- rule applies to grants, not revocations. A database floor, not app code, because
-- app code can be bypassed.
CREATE FUNCTION enforce_mentor_dm_signed_form() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.grant_type = 'mentor_dm' AND NEW.revoked_at IS NULL THEN
    IF NEW.method <> 'signed_form' THEN
      RAISE EXCEPTION
        'mentor_dm consent requires a signed_form method, not % (subject %)',
        NEW.method, NEW.subject_student_account_id
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.evidence_artifact_ref IS NULL THEN
      RAISE EXCEPTION
        'mentor_dm consent requires a non-null evidence_artifact_ref (subject %)',
        NEW.subject_student_account_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER consent_grant_mentor_dm_signed_form
  BEFORE INSERT ON consent_grant
  FOR EACH ROW EXECUTE FUNCTION enforce_mentor_dm_signed_form();

-- --- safety_officer not-a-peer floor (design C.1) --------------------------
-- An account cannot hold `safety_officer` in a chapter where it ALSO holds a
-- mentor/teaching or student membership, and vice versa -- independence is the
-- point (peer review does not escalate). Checked on membership INSERT/UPDATE for
-- an ACTIVE-or-PENDING row: if the NEW row is safety_officer, refuse when a
-- teaching/student membership exists for the same (account, chapter); if the NEW
-- row is teaching/student, refuse when a safety_officer membership exists. Only
-- non-terminated memberships (status not in offboarded) count as a live peer. An
-- opaque error (the assignment service maps it to a generic refusal).
CREATE FUNCTION enforce_safety_officer_not_peer() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE conflict_role text;
BEGIN
  IF NEW.status = 'offboarded' THEN
    RETURN NEW;
  END IF;
  IF NEW.role = 'safety_officer' THEN
    SELECT role INTO conflict_role FROM membership
      WHERE account_id = NEW.account_id AND chapter_id = NEW.chapter_id
        AND id <> NEW.id
        AND status <> 'offboarded'
        AND role IN ('student','junior_mentor','senior_instructor','lead_instructor','chapter_director')
      LIMIT 1;
    IF conflict_role IS NOT NULL THEN
      RAISE EXCEPTION
        'a safety_officer cannot be a mentor/teaching or student in the same chapter'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.role IN ('student','junior_mentor','senior_instructor','lead_instructor','chapter_director') THEN
    SELECT role INTO conflict_role FROM membership
      WHERE account_id = NEW.account_id AND chapter_id = NEW.chapter_id
        AND id <> NEW.id
        AND status <> 'offboarded'
        AND role = 'safety_officer'
      LIMIT 1;
    IF conflict_role IS NOT NULL THEN
      RAISE EXCEPTION
        'a mentor/teaching or student cannot also be the safety_officer in the same chapter'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER membership_safety_officer_not_peer
  BEFORE INSERT OR UPDATE ON membership
  FOR EACH ROW EXECUTE FUNCTION enforce_safety_officer_not_peer();

-- --- dm_thread (INSERT-once; append-only) ----------------------------------
-- One row per authorized mentor<->student thread. Binds the chapter, the mentor's
-- membership, and the student's account (the guardian party is resolved from the
-- verified guardianship at read time, not stored). Carries the permanent,
-- identical-to-all visibility header text + version (design C.2). The row is
-- INSERT-once -- no column is ever mutated (last_message_at is derived by the view).
CREATE TABLE dm_thread (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id                uuid NOT NULL REFERENCES chapter (id),
  mentor_membership_id      uuid NOT NULL REFERENCES membership (id),
  student_account_id        uuid NOT NULL REFERENCES account (id),
  visibility_header_version text NOT NULL,
  visibility_header_text    text NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dm_thread_chapter_idx ON dm_thread (chapter_id);
CREATE INDEX dm_thread_mentor_idx ON dm_thread (mentor_membership_id);
CREATE INDEX dm_thread_student_idx ON dm_thread (student_account_id);
-- One thread per (mentor, student) pair.
CREATE UNIQUE INDEX dm_thread_pair_unique ON dm_thread (mentor_membership_id, student_account_id);

-- --- dm_message (append-only; body ENCRYPTED at rest) ----------------------
-- One post in a thread. `seq` gives a total, gap-tolerant order (bigserial).
-- `body` is the AES-256-GCM {v, iv, ct, tag} envelope (packages/runtime
-- field-crypto.ts) -- NEVER plaintext. The CHECK requires the envelope keys so a
-- plaintext value cannot be stored. Decryption happens server-side on read for an
-- authorized party. Append-only: a correction is a NEW message, never an UPDATE.
CREATE TABLE dm_message (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq               bigserial NOT NULL UNIQUE,
  thread_id         uuid NOT NULL REFERENCES dm_thread (id),
  sender_account_id uuid NOT NULL REFERENCES account (id),
  body              jsonb NOT NULL,
  sent_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dm_message_body_encrypted CHECK (body ?& array['v','iv','ct','tag'])
);

CREATE INDEX dm_message_thread_seq_idx ON dm_message (thread_id, seq);

-- --- Append-only enforcement (trigger backstop; shares the 0001 function) ---
CREATE TRIGGER dm_thread_append_only
  BEFORE UPDATE OR DELETE ON dm_thread
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER dm_message_append_only
  BEFORE UPDATE OR DELETE ON dm_message
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

-- --- dm_thread_current (derived last_message_at projection) -----------------
-- The thread's fields plus a DERIVED last_message_at = max(sent_at) over its
-- messages, coalesced to created_at when it has none yet. A VIEW, so the thread
-- row stays immutable while last_message_at advances as messages append -- the
-- same posture as message_thread_current (Feature 3).
CREATE VIEW dm_thread_current AS
SELECT
  t.id,
  t.chapter_id,
  t.mentor_membership_id,
  t.student_account_id,
  t.visibility_header_version,
  t.visibility_header_text,
  t.created_at,
  COALESCE(max(m.sent_at), t.created_at) AS last_message_at,
  count(m.id) AS message_count
FROM dm_thread t
LEFT JOIN dm_message m ON m.thread_id = t.id
GROUP BY t.id;

-- --- dm_insurance_attestation (Part D enable precondition) ------------------
-- Records that abuse-and-molestation insurance coverage is confirmed for a
-- chapter (design A.4/A.5, Part D). Append-only -- a correction is a new row; the
-- enable gate reads whether ANY attestation exists for the chapter.
CREATE TABLE dm_insurance_attestation (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id  uuid NOT NULL REFERENCES chapter (id),
  carrier     text,
  policy_ref  text,
  attested_by uuid NOT NULL REFERENCES account (id),
  attested_at timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dm_insurance_attestation_chapter_idx ON dm_insurance_attestation (chapter_id);
CREATE TRIGGER dm_insurance_attestation_append_only
  BEFORE UPDATE OR DELETE ON dm_insurance_attestation
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

-- --- dm_chapter_switch (Part D: the chapter DM switch) ----------------------
-- Records that DM is turned ON for a chapter (design Part D). Append-only; the
-- switch is "on" for a chapter iff a row exists. dm.enable refuses to write it
-- unless the enable-preconditions hold (a safety officer assigned + an insurance
-- attestation + >=1 current-term pod) -- checked in DmEnableService. Even with a
-- row present, the GLOBAL MENTOR_DM_ENABLED flag must ALSO be on for any DM to run.
CREATE TABLE dm_chapter_switch (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id uuid NOT NULL REFERENCES chapter (id),
  enabled_by uuid NOT NULL REFERENCES account (id),
  enabled_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX dm_chapter_switch_chapter_unique ON dm_chapter_switch (chapter_id);
CREATE TRIGGER dm_chapter_switch_append_only
  BEFORE UPDATE OR DELETE ON dm_chapter_switch
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

-- --- Mechanism A grants (0002) ---------------------------------------------
-- All four tables are append-only: the app / rls roles SELECT+INSERT only (the
-- role-level belt to the trigger's braces), mirroring message_thread / message.
GRANT SELECT, INSERT ON dm_thread TO curiolab_app;
GRANT SELECT, INSERT ON dm_thread TO curiolab_rls;
GRANT SELECT, INSERT ON dm_message TO curiolab_app;
GRANT SELECT, INSERT ON dm_message TO curiolab_rls;
GRANT SELECT ON dm_thread_current TO curiolab_app;
GRANT SELECT ON dm_thread_current TO curiolab_rls;
GRANT SELECT, INSERT ON dm_insurance_attestation TO curiolab_app;
GRANT SELECT, INSERT ON dm_insurance_attestation TO curiolab_rls;
GRANT SELECT, INSERT ON dm_chapter_switch TO curiolab_app;
GRANT SELECT, INSERT ON dm_chapter_switch TO curiolab_rls;

-- The bigserial `seq` sequence needs its own USAGE grant (0002's ON ALL SEQUENCES
-- bound only the sequences that existed then).
GRANT USAGE, SELECT ON SEQUENCE dm_message_seq_seq TO curiolab_app, curiolab_rls;
