-- =========================================================================
-- 0034_application_form.sql — the EDITABLE, versioned, per-chapter application
-- form definition (docs/platform/application-form-definition-spec.md). A chapter
-- director edits the questions applicants answer (parent Stage-2A + student
-- Stage-2B); the apply funnel renders from the stored PUBLISHED definition, and
-- the director portal renders each application's answers against the questions
-- the applicant actually saw (the version stamped at draft time).
--
-- Data model:
--   application_form
--     id           uuid pk
--     chapter_id   uuid fk -> chapter (NULLABLE = the platform default)
--     version      int          -- monotonic per chapter (per chapter_id)
--     status       text         -- 'draft' | 'published'
--     definition   jsonb        -- matches lib/portal/director/application-form.ts
--     created_by   uuid fk -> account (NULLABLE — the platform-default seed has none)
--     created_at   timestamptz
--     published_at timestamptz null
--     unique (chapter_id, version)
--
-- Versions are RETAINED: a new version is a NEW row; a published row is never
-- mutated. The role-level grant is SELECT + INSERT only (no UPDATE/DELETE) — the
-- belt that makes "never mutate a published version" a database guarantee, the
-- same append-only posture as consent_grant / calendar_event / mentor_eligibility.
--
-- Override 2 (version stamping): application_draft and application each gain a
-- (form_id, form_version) stamp. startStage2 captures the chapter's currently
-- PUBLISHED form onto the draft; submitStage2 carries it to the application, so
-- getApplication can render the answers against the exact version the applicant
-- saw — even after the director later edits and republishes the form.
--
-- --- Guarantees with a red-before-green witness (test/application-form-schema.test.ts)
--   * application_form exists; the chapter fk is nullable (platform default);
--     unique(chapter_id, version) bites; the status CHECK bounds 'draft'|'published';
--   * the platform-default row is seeded (chapter_id null, version 1, published)
--     and its definition carries the parent + student sections;
--   * application_draft / application carry the (form_id, form_version) stamp;
--   * Mechanism-A grants: app may SELECT/INSERT application_form (not UPDATE/DELETE).
--
-- TDD: run with CURIOLAB_MIGRATE_UPTO=0033 to witness these fail (the relation
-- does not exist yet); the default run applies 0034 and they pass.
-- =========================================================================

CREATE TABLE application_form (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id    uuid REFERENCES chapter (id),
  version       integer NOT NULL,
  status        text NOT NULL CHECK (status IN ('draft', 'published')),
  definition    jsonb NOT NULL,
  created_by    uuid REFERENCES account (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz,
  UNIQUE (chapter_id, version),
  -- A published row must carry its publish time; a draft must not.
  CONSTRAINT application_form_published_at_ck
    CHECK ((status = 'published') = (published_at IS NOT NULL))
);

-- The per-chapter "current" resolution reads the latest version by (chapter_id,
-- version); the funnel resolution reads the latest PUBLISHED row for a chapter
-- (or the platform default, chapter_id IS NULL).
CREATE INDEX application_form_chapter_version_idx
  ON application_form (chapter_id, version DESC);

-- Override 2: the version stamp. Nullable — pre-existing drafts/applications and
-- any created before a form is resolved carry null; a chapter always resolves at
-- least the platform default at startStage2, so new drafts are stamped.
ALTER TABLE application_draft
  ADD COLUMN form_id uuid REFERENCES application_form (id),
  ADD COLUMN form_version integer;

ALTER TABLE application
  ADD COLUMN form_id uuid REFERENCES application_form (id),
  ADD COLUMN form_version integer;

-- --- The platform-default row (chapter_id NULL, version 1, published) ---------
-- Transcribes the current hardcoded funnel questions. The parent section mirrors
-- lib/portal/director/application-form.ts defaultForm() verbatim (fixed flags on
-- the enrollment-critical identity + consent fields). The student section uses
-- the seven STAGE2_STUDENT_ALLOWED_FIELDS keys (packages/app/src/config.ts) so
-- the platform default satisfies override 1 (every student key on the allowlist).
INSERT INTO application_form (chapter_id, version, status, definition, created_by, published_at)
VALUES (
  NULL, 1, 'published',
  $json$
  {
    "version": 1,
    "sections": [
      {
        "id": "parent",
        "title": "Parent / guardian section",
        "description": "Completed by the parent or guardian. Identity and consent fields are required by the platform and can't be removed.",
        "questions": [
          { "id": "p_childFirstName", "key": "childFirstName", "label": "Child first name", "type": "short_text", "required": true, "fixed": true },
          { "id": "p_childLastName", "key": "childLastName", "label": "Child last name", "type": "short_text", "required": true, "fixed": true },
          { "id": "p_childDob", "key": "childDob", "label": "Child date of birth", "type": "date", "required": true, "fixed": true },
          { "id": "p_gradeEntering", "key": "gradeEntering", "label": "Grade entering in the fall", "type": "dropdown", "required": true, "fixed": true, "options": ["6", "7", "8", "9", "10", "11", "12"] },
          { "id": "p_schoolName", "key": "schoolName", "label": "School", "type": "short_text", "required": true },
          { "id": "p_guardianFirstName", "key": "guardianFirstName", "label": "Parent / guardian first name", "type": "short_text", "required": true, "fixed": true },
          { "id": "p_guardianLastName", "key": "guardianLastName", "label": "Parent / guardian last name", "type": "short_text", "required": true, "fixed": true },
          { "id": "p_guardianEmail", "key": "guardianEmail", "label": "Guardian email", "type": "email", "required": true, "fixed": true },
          { "id": "p_guardianPhone", "key": "guardianPhone", "label": "Phone", "type": "phone", "required": true },
          { "id": "p_relationship", "key": "relationship", "label": "Relationship to student", "type": "dropdown", "required": true, "fixed": true, "options": ["Parent", "Legal guardian", "Grandparent", "Foster parent", "Other"] },
          { "id": "p_secondGuardianName", "key": "secondGuardianName", "label": "Second guardian", "type": "short_text", "required": false },
          { "id": "p_secondGuardianEmail", "key": "secondGuardianEmail", "label": "Second guardian email", "type": "email", "required": false },
          { "id": "p_saturdayAvailability", "key": "saturdayAvailability", "label": "We can commit to Saturday sessions", "type": "consent", "required": true, "fixed": true },
          { "id": "p_commitmentAcknowledged", "key": "commitmentAcknowledged", "label": "I acknowledge the program commitment", "type": "consent", "required": true, "fixed": true },
          { "id": "p_scholarshipInterest", "key": "scholarshipInterest", "label": "Send me information about scholarships", "type": "consent", "required": false },
          { "id": "p_attestedGuardian", "key": "attestedGuardian", "label": "I attest I am the parent or legal guardian", "type": "consent", "required": true, "fixed": true },
          { "id": "p_contactConsent", "key": "contactConsent", "label": "I consent to be contacted about this application", "type": "consent", "required": true, "fixed": true }
        ]
      },
      {
        "id": "student",
        "title": "Student questionnaire",
        "description": "Completed by the student. Free-form questions you can add, reword, reorder or remove.",
        "questions": [
          { "id": "s_interests", "key": "interests", "label": "What do you like doing when you're not in school?", "type": "long_text", "required": true },
          { "id": "s_motivation", "key": "motivation", "label": "Why do you want to join CurioLab?", "type": "long_text", "required": true },
          { "id": "s_curiosity", "key": "curiosity", "label": "What's something you're curious about right now - in school or outside it?", "type": "long_text", "required": true },
          { "id": "s_proud_build", "key": "proud_build", "label": "Tell us about something you built, made, or fixed that you were proud of.", "type": "long_text", "required": true },
          { "id": "s_problem_to_fix", "key": "problem_to_fix", "label": "Is there a problem you've noticed at school, in your neighborhood, or in your community that you wish someone would fix?", "type": "long_text", "required": true },
          { "id": "s_goals", "key": "goals", "label": "What do you hope to learn or make by the end of your first semester?", "type": "long_text", "required": true },
          { "id": "s_prior_experience", "key": "prior_experience", "label": "Have you done any coding, building, or making before?", "type": "long_text", "required": false }
        ]
      }
    ]
  }
  $json$::jsonb,
  NULL, now()
);

-- --- Mechanism A grants (0002) ---------------------------------------------
-- application_form is append-only at the role level: the app / rls roles
-- SELECT + INSERT only (a new version is a new row; a published row is never
-- mutated), mirroring calendar_event / consent_grant / mentor_eligibility.
GRANT SELECT, INSERT ON application_form TO curiolab_app;
GRANT SELECT, INSERT ON application_form TO curiolab_rls;
