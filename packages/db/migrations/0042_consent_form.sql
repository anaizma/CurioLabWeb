-- =========================================================================
-- 0042_consent_form.sql — director-editable, versioned consent-form DEFINITIONS.
-- The authored form: a display PDF (bytea) + app-layer checkbox items + typed
-- detail fields, per audience. Mirrors 0034_application_form: versioned by
-- new-row, append-only (SELECT+INSERT only), per-chapter with chapter_id NULL =
-- platform default. Distinct from 0039's consent_form_* SUBMISSION tables.
-- Red state witnessed at CURIOLAB_MIGRATE_UPTO=0039.
--
-- Numbering note: the spec drafted this as 0040, but 0040/0041 already exist on
-- this branch (password_change_required, application_lead_last_requested), so it
-- lands as the next free number, 0042. The red-state witness is unaffected: at
-- CURIOLAB_MIGRATE_UPTO=0039 the table still does not exist.
-- =========================================================================
CREATE TABLE consent_form (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq          bigserial NOT NULL UNIQUE,
  form_key     text NOT NULL,
  chapter_id   uuid REFERENCES chapter (id),        -- NULL = platform default
  version      integer NOT NULL,
  status       text NOT NULL CHECK (status IN ('draft', 'published')),
  audience     text NOT NULL CHECK (audience IN ('guardian', 'mentor', 'student')),
  document_id  text,
  title        text NOT NULL,
  elevated     boolean NOT NULL DEFAULT false,
  pdf          bytea NOT NULL,
  pdf_sha256   text NOT NULL,
  items        jsonb NOT NULL,   -- [{itemKey,text,required,elevated,grantMapping?}]
  fields       jsonb NOT NULL,   -- [{fieldType,label,inputType,required,fixed}]
  created_by   uuid REFERENCES account (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CONSTRAINT consent_form_published_needs_ts CHECK (status <> 'published' OR published_at IS NOT NULL),
  UNIQUE (chapter_id, form_key, version)
);
CREATE INDEX consent_form_lookup_idx ON consent_form (audience, chapter_id, form_key, version DESC);

CREATE TRIGGER consent_form_append_only
  BEFORE UPDATE OR DELETE ON consent_form
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

GRANT SELECT, INSERT ON consent_form TO curiolab_app, curiolab_rls;
GRANT USAGE, SELECT ON SEQUENCE consent_form_seq_seq TO curiolab_app, curiolab_rls;
