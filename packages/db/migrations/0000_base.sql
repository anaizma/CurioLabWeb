-- =========================================================================
-- 0000_base.sql — extensions, enums, and the Milestone 0 tables.
--
-- This migration is the plain structural floor: tables, foreign keys, NOT
-- NULL, the identity "exactly one of email/username" check, and the ordinary
-- indexes. The compliance GUARANTEES (DOB trigger, consent checks, single
-- active membership, evidence-backed tier, append-only, consent_current,
-- impersonation-of-minor, alumni shape, guardian-invite binding) are added in
-- 0001_guarantees.sql so that each has a red-before-green test.
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS citext;

-- --- enums (mirror packages/db/src/enums.ts) -----------------------------
CREATE TYPE role AS ENUM (
  'platform_admin', 'platform_staff', 'chapter_director', 'lead_instructor',
  'senior_instructor', 'junior_mentor', 'comms_associate', 'student', 'alumni'
);
CREATE TYPE account_status AS ENUM ('invited', 'pending', 'active', 'suspended', 'closed');
CREATE TYPE maturation_state AS ENUM ('minor', 'maturation_pending', 'self_managed');
CREATE TYPE credential_owner AS ENUM ('guardian_provisioned', 'self_private');
CREATE TYPE membership_status AS ENUM ('pending', 'active', 'inactive', 'offboarded', 'suspended');
CREATE TYPE session_mode AS ENUM ('full', 'read_only');
CREATE TYPE tier AS ENUM ('explorer', 'builder', 'innovator');
CREATE TYPE consent_type AS ENUM (
  'enrollment', 'data_collection', 'platform_participation',
  'public_profile', 'photo_media', 'external_publication'
);
CREATE TYPE chapter_tier AS ENUM ('seed', 'active', 'distinguished');
CREATE TYPE chapter_status AS ENUM ('prospective', 'active', 'paused', 'closed');
CREATE TYPE dob_provenance AS ENUM ('enrollment_record', 'self_reported', 'staff_entered');
CREATE TYPE invite_kind AS ENUM ('guardian', 'student', 'mentor', 'staff');
CREATE TYPE invite_status AS ENUM ('issued', 'accepted', 'expired', 'revoked');
CREATE TYPE delivery_status AS ENUM ('sent', 'delivered', 'bounced', 'complained');
CREATE TYPE application_kind AS ENUM ('student', 'university_role');
CREATE TYPE application_status AS ENUM (
  'submitted', 'screening', 'interview_scheduled', 'accepted',
  'enrolled', 'declined', 'withdrawn'
);
CREATE TYPE relationship AS ENUM ('parent', 'guardian', 'other');
CREATE TYPE guardianship_status AS ENUM ('pending', 'verified', 'rejected', 'revoked', 'lapsed');
CREATE TYPE verification_method AS ENUM ('signed_form_match', 'in_person_witnessed', 'sms_form_match');
CREATE TYPE consent_action AS ENUM ('grant', 'revoke');
CREATE TYPE consent_source AS ENUM ('signed_form', 'digital');
CREATE TYPE consent_reason AS ENUM ('standard', 'safeguarding');

-- --- org structure -------------------------------------------------------
CREATE TABLE chapter (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text NOT NULL UNIQUE,
  tier       chapter_tier NOT NULL,
  status     chapter_status NOT NULL,
  timezone   text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE term (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id uuid NOT NULL REFERENCES chapter (id),
  name       text NOT NULL,
  starts_on  date NOT NULL,
  ends_on    date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX term_chapter_ends_idx ON term (chapter_id, ends_on);

-- --- core identity -------------------------------------------------------
CREATE TABLE account (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            citext,
  username         citext,
  legal_name       text NOT NULL,
  display_name     text NOT NULL,
  date_of_birth    date NOT NULL,
  dob_provenance   dob_provenance NOT NULL,
  dob_source_ref   uuid,
  password_hash    text,
  credential_owner credential_owner NOT NULL,
  status           account_status NOT NULL,
  maturation_state maturation_state NOT NULL,
  created_by       uuid REFERENCES account (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_identity_one_of CHECK ((email IS NULL) <> (username IS NULL))
);
CREATE UNIQUE INDEX account_email_unique ON account (email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX account_username_unique ON account (username) WHERE username IS NOT NULL;

CREATE TABLE pod (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id           uuid NOT NULL REFERENCES chapter (id),
  term_id              uuid NOT NULL REFERENCES term (id),
  name                 text NOT NULL,
  mentor_membership_id uuid, -- FK added after membership exists (circular)
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE application (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                    application_kind NOT NULL,
  chapter_id              uuid NOT NULL REFERENCES chapter (id),
  status                  application_status NOT NULL,
  applicant_name          text NOT NULL,
  applicant_contact_email citext NOT NULL,
  guardian_name           text,
  guardian_email          citext,
  guardian_signature_ref  uuid,
  track                   text,
  github_url              text,
  reopened_from_id        uuid REFERENCES application (id),
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE enrollment_record (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id       uuid NOT NULL REFERENCES application (id),
  student_account_id   uuid REFERENCES account (id),
  chapter_id           uuid NOT NULL REFERENCES chapter (id),
  term_id              uuid NOT NULL REFERENCES term (id),
  signed_form_ref      uuid NOT NULL,
  guardian_name_on_form text NOT NULL,
  created_by           uuid NOT NULL REFERENCES account (id),
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE membership (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES account (id),
  chapter_id   uuid NOT NULL REFERENCES chapter (id),
  role         role NOT NULL,
  status       membership_status NOT NULL,
  term_id      uuid REFERENCES term (id),
  active_from  date,
  active_until date,
  pod_id       uuid REFERENCES pod (id),
  current_tier tier,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX membership_account_status_idx ON membership (account_id, status);

ALTER TABLE pod
  ADD CONSTRAINT pod_mentor_membership_fk
  FOREIGN KEY (mentor_membership_id) REFERENCES membership (id);

CREATE TABLE pod_assignment (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL REFERENCES membership (id),
  pod_id        uuid NOT NULL REFERENCES pod (id),
  term_id       uuid NOT NULL REFERENCES term (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pod_assignment_unique UNIQUE (membership_id, pod_id, term_id)
);

CREATE TABLE session (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash              text NOT NULL UNIQUE,
  account_id              uuid NOT NULL REFERENCES account (id),
  mode                    session_mode NOT NULL,
  impersonated_account_id uuid REFERENCES account (id),
  real_actor_account_id   uuid REFERENCES account (id),
  expires_at              timestamptz NOT NULL,
  revoked_at              timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invite (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash           text NOT NULL,
  kind                 invite_kind NOT NULL,
  target_email         citext,
  intended_account_id  uuid REFERENCES account (id),
  enrollment_record_id uuid REFERENCES enrollment_record (id),
  issued_by            uuid NOT NULL REFERENCES account (id),
  expires_at           timestamptz NOT NULL,
  accepted_at          timestamptz,
  status               invite_status NOT NULL,
  delivery_status      delivery_status NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE application_event (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES application (id),
  from_status    application_status,
  to_status      application_status NOT NULL,
  actor_id       uuid REFERENCES account (id),
  note           text,
  at             timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- evidence_ref starts NULLABLE; 0001 flips it to NOT NULL (red-before-green).
CREATE TABLE tier_transition (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL REFERENCES membership (id),
  from_tier     tier,
  to_tier       tier NOT NULL,
  granted_by    uuid NOT NULL REFERENCES account (id),
  evidence_ref  uuid,
  note          text,
  at            timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE guardianship (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guardian_account_id uuid NOT NULL REFERENCES account (id),
  student_account_id  uuid NOT NULL REFERENCES account (id),
  relationship        relationship NOT NULL,
  status              guardianship_status NOT NULL,
  verification_method verification_method NOT NULL,
  verified_by         uuid REFERENCES account (id),
  source_ref          uuid,
  verified_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE consent (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq                bigserial NOT NULL UNIQUE,
  student_account_id uuid NOT NULL REFERENCES account (id),
  type               consent_type NOT NULL,
  action             consent_action NOT NULL,
  source             consent_source NOT NULL,
  source_ref         uuid,
  scope_ref          uuid,
  granted_by         uuid REFERENCES account (id),
  effective_at       timestamptz NOT NULL,
  reason             consent_reason NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE consent_current (
  student_account_id uuid NOT NULL REFERENCES account (id),
  type               consent_type NOT NULL,
  consent_id         uuid NOT NULL REFERENCES consent (id),
  active             boolean NOT NULL,
  action             consent_action NOT NULL,
  effective_at       timestamptz NOT NULL,
  seq                bigint NOT NULL,
  source_ref         uuid,
  scope_ref          uuid,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_account_id, type)
);

CREATE TABLE audit_entry (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at                    timestamptz NOT NULL DEFAULT now(),
  actor_account_id      uuid REFERENCES account (id),
  real_actor_account_id uuid REFERENCES account (id),
  action                text NOT NULL,
  subject_type          text NOT NULL,
  subject_id            uuid,
  chapter_id            uuid REFERENCES chapter (id),
  detail                jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_subject_idx ON audit_entry (subject_type, subject_id, at);
CREATE INDEX audit_actor_idx ON audit_entry (actor_account_id, at);
