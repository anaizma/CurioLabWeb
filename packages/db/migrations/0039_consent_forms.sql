-- =========================================================================
-- 0039_consent_forms.sql — guardian consent-form completion + signature store.
-- ADDITIVE. Two append-only ledgers (the immutable per-form audit record and its
-- bound signature — together the evidence artifact referenced by consent_grant.
-- evidence_artifact_ref), plus two mutable per-guardian work tables (the autofill
-- store and the in-progress draft). Append-only via reject_append_only_mutation()
-- + role REVOKE, mirroring 0024. Red state witnessed at CURIOLAB_MIGRATE_UPTO=0038.
-- =========================================================================

-- --- consent_form_completion (append-only, the evidence artifact) ----------
CREATE TABLE consent_form_completion (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq                        bigserial NOT NULL UNIQUE,
  form_id                    text NOT NULL,
  form_version               text NOT NULL,
  pdf_sha256                 text NOT NULL,
  subject_student_account_id uuid REFERENCES account (id),
  signer_account_id          uuid NOT NULL REFERENCES account (id),
  audience                   text NOT NULL,
  item_states                jsonb NOT NULL,
  field_values               jsonb NOT NULL,
  signature_ref              uuid NOT NULL,
  verification               jsonb,
  submitted_at               timestamptz NOT NULL DEFAULT now(),
  created_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consent_form_completion_subject_idx
  ON consent_form_completion (subject_student_account_id, form_id, seq DESC);
CREATE INDEX consent_form_completion_signer_idx
  ON consent_form_completion (signer_account_id, form_id, seq DESC);

-- --- consent_signature (append-only) ---------------------------------------
CREATE TABLE consent_signature (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq           bigserial NOT NULL UNIQUE,
  completion_id uuid NOT NULL,
  image         bytea NOT NULL,
  width         integer,
  height        integer,
  captured_at   timestamptz NOT NULL DEFAULT now(),
  binding       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consent_signature_completion_idx ON consent_signature (completion_id);

-- --- guardian_saved_field (mutable — the autofill store) -------------------
CREATE TABLE guardian_saved_field (
  guardian_account_id uuid NOT NULL REFERENCES account (id),
  field_type          text NOT NULL,
  value_text          text,
  value_blob          bytea,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guardian_account_id, field_type)
);

-- --- consent_form_draft (mutable — leave/resume) ---------------------------
CREATE TABLE consent_form_draft (
  guardian_account_id        uuid NOT NULL REFERENCES account (id),
  subject_student_account_id uuid REFERENCES account (id),
  form_id                    text NOT NULL,
  item_states                jsonb,
  field_values               jsonb,
  signature                  bytea,
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guardian_account_id, subject_student_account_id, form_id)
);

-- --- Append-only enforcement (shares the 0001 function) --------------------
CREATE TRIGGER consent_form_completion_append_only
  BEFORE UPDATE OR DELETE ON consent_form_completion
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER consent_signature_append_only
  BEFORE UPDATE OR DELETE ON consent_signature
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

-- --- Mechanism A grants ----------------------------------------------------
GRANT SELECT, INSERT ON consent_form_completion TO curiolab_app, curiolab_rls;
GRANT SELECT, INSERT ON consent_signature TO curiolab_app, curiolab_rls;
GRANT SELECT, INSERT, UPDATE, DELETE ON guardian_saved_field TO curiolab_app, curiolab_rls;
GRANT SELECT, INSERT, UPDATE, DELETE ON consent_form_draft TO curiolab_app, curiolab_rls;
GRANT USAGE, SELECT ON SEQUENCE consent_form_completion_seq_seq TO curiolab_app, curiolab_rls;
GRANT USAGE, SELECT ON SEQUENCE consent_signature_seq_seq TO curiolab_app, curiolab_rls;
