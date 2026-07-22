-- =========================================================================
-- 0008_guardian_portal_tables.sql — the request and fee tables the guardian
-- portal reads and files against (Milestone 1 step 7; 02-data-model.md
-- "payment_ref and scholarship", "deletion_request", and the export request of
-- compliance-coppa.md Part 2 Stage 4).
--
-- These are plain structural tables plus ONE compliance guarantee: a refused
-- deletion decision must carry a documented reason (02-data-model.md
-- deletion_request: "A refusal must carry a documented reason"). That rule is a
-- CHECK here so a reason-less refusal cannot be written by any path, matching
-- the "guarantee lives in the database" discipline of 0001/0004/0006.
--
-- Money is never a source of truth here (02-data-model.md): payment_ref carries
-- a Stripe reference and a coarse status only — no amount, no card data — and
-- scholarship carries a percentage, not a dollar figure. status is read-only in
-- the portal; the Stripe webhook (05-api-surface.md) is the only writer of it,
-- and lands with the ops HTTP layer (step 8), not here.
--
-- Mechanism A note: 0002_roles.sql granted DML on ALL TABLES THEN EXISTING, so
-- these later tables carry no grant to curiolab_app or curiolab_analytics — a
-- strictly-more-restrictive default than the intended REVOKE. The explicit
-- app-role grant and the analytics-denied mirror test for the financial tables
-- (payment_ref, scholarship) are the documented Milestone 3 extension of that
-- migration (migrations/README.md "how Milestone 3 extends it"); the guardian
-- portal service runs as the table owner and does not depend on them.
-- =========================================================================

-- --- enums (mirror packages/db/src/enums.ts) -----------------------------
CREATE TYPE payment_status AS ENUM ('none', 'active', 'past_due', 'waived');
CREATE TYPE deletion_scope AS ENUM ('full', 'redaction');
CREATE TYPE deletion_request_status AS ENUM (
  'requested', 'under_review', 'fulfilled_full', 'fulfilled_redaction',
  'partially_fulfilled', 'refused'
);
CREATE TYPE export_request_status AS ENUM ('requested', 'fulfilled');

-- --- money (no amounts as a source of truth) -----------------------------
CREATE TABLE payment_ref (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_record_id uuid NOT NULL REFERENCES enrollment_record (id),
  stripe_customer_ref  text,
  status               payment_status NOT NULL,
  tier_paid_for        text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE scholarship (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_record_id uuid NOT NULL REFERENCES enrollment_record (id),
  awarded_by           uuid NOT NULL REFERENCES account (id),
  percentage           integer NOT NULL,
  note                 text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- --- ongoing-rights requests (compliance-coppa.md Part 2 Stage 4) --------
-- The review right: filed by a guardian, fulfilled by staff (the export bundle
-- itself is later tooling; this row is the request record).
CREATE TABLE export_request (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_account_id uuid NOT NULL REFERENCES account (id),
  requested_by       uuid NOT NULL REFERENCES account (id),
  status             export_request_status NOT NULL,
  fulfilled_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- The delete right: filed by a guardian with a scope; the decision fields
-- (reviewed_by / decision_reason / decided_at) are written once by the ops
-- review (step 8). A refused decision MUST carry a documented reason.
CREATE TABLE deletion_request (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_account_id uuid NOT NULL REFERENCES account (id),
  requested_by       uuid NOT NULL REFERENCES account (id),
  scope_requested    deletion_scope NOT NULL,
  status             deletion_request_status NOT NULL,
  reviewed_by        uuid REFERENCES account (id),
  decision_reason    text,
  decided_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deletion_request_refusal_reason
    CHECK (status <> 'refused' OR decision_reason IS NOT NULL)
);
