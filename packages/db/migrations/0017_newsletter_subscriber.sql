-- =========================================================================
-- 0017_newsletter_subscriber.sql — Milestone 3.6: the newsletter subscriber
-- list and the webhook idempotency ledger. (02-data-model.md "Newsletter and
-- money" — newsletter_subscriber — and 05-api-surface.md's unauthenticated
-- write set: POST /public/newsletter/subscribe (double opt-in),
-- GET /public/newsletter/unsubscribe/:token, and the two signature-verified,
-- idempotent provider webhooks.)
--
-- newsletter_subscriber lives OUTSIDE the account graph — no fk to account
-- (02-data-model.md: "No foreign key to account"). A subscriber is just a
-- contactable email, a source, a delivery status fed by the Resend webhook, and
-- the two token hashes that gate the double-opt-in confirm and the unsubscribe
-- link. The one LIVE subscriber per email is the partial unique index
-- (email) WHERE unsubscribed_at IS NULL: a pending (unconfirmed) or confirmed
-- subscriber occupies the slot, and an unsubscribe frees it so a later
-- re-subscribe of the same address starts a fresh row.
--
-- The double-opt-in columns (confirm_token_hash, confirmed_at) are additive to
-- the 02-data-model.md columns; 05-api-surface.md requires "double opt-in" for the
-- subscribe endpoint, which needs a pending state and a confirm token, so they
-- are carried here. confirmed_at NULL = pending; set at confirm = active.
-- delivery_status is a SEPARATE axis (active|bounced|complained) fed only by the
-- Resend webhook — never the subscribe/confirm/unsubscribe flow.
--
-- webhook_event is the idempotency ledger for BOTH provider webhooks: the PK
-- (provider, event_id) makes a replayed provider event a no-op (INSERT ...
-- ON CONFLICT DO NOTHING inside the same transaction as the status mutation, so
-- a replay processes nothing). It is an internal ledger, not learner data.
--
-- Mechanism A (0002): the app role gets DML on both tables; the analytics read
-- role is deliberately NOT granted — the subscriber list holds contactable
-- family emails, the same default-deny stance the M3.5 newsletter tables take.
--
-- Guarantees with a red-before-green test in test/newsletter-subscriber-
-- schema.test.ts:
--   * newsletter_subscriber.delivery_status defaults 'active'; invalid enum
--     rejected; email NOT NULL; email is citext; NO account fk;
--   * the partial unique index — one LIVE subscriber per email, freed on
--     unsubscribe;
--   * webhook_event PK dedups a replayed (provider, event_id); the same
--     event_id under a different provider is allowed;
--   * app DML; analytics denied SELECT.
-- CURIOLAB_MIGRATE_UPTO=0016 witnesses the red state (the relations are absent).
-- =========================================================================

-- --- enum (mirror packages/db/src/enums.ts) ------------------------------
-- Distinct from the invite/delivery `delivery_status` enum (sent|delivered|
-- bounced|complained): a subscriber's delivery axis is active|bounced|complained
-- (02-data-model.md newsletter_subscriber).
CREATE TYPE newsletter_subscriber_delivery_status AS ENUM (
  'active', 'bounced', 'complained'
);

-- --- newsletter_subscriber ----------------------------------------------
-- No fk to account (02-data-model.md). email is citext so the live-uniqueness
-- match and the webhook recipient match are case-insensitive. The token hashes
-- store only the SHA-256 of the opaque confirm/unsubscribe tokens (the raw
-- tokens are the mailer's seam, never persisted).
CREATE TABLE newsletter_subscriber (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                  citext NOT NULL,
  unsubscribe_token_hash text,
  confirm_token_hash     text,
  confirmed_at           timestamptz,
  subscribed_at          timestamptz NOT NULL DEFAULT now(),
  unsubscribed_at        timestamptz,
  source                 text,
  delivery_status        newsletter_subscriber_delivery_status NOT NULL DEFAULT 'active',
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- One LIVE subscriber per email; an unsubscribed row (unsubscribed_at set) frees
-- the slot for a later re-subscribe (02-data-model.md: "Unique (email) WHERE
-- unsubscribed_at IS NULL"). This is also the idempotency floor for `subscribe`.
CREATE UNIQUE INDEX newsletter_subscriber_live_email_unique
  ON newsletter_subscriber (email) WHERE unsubscribed_at IS NULL;

-- The unsubscribe/confirm token lookups hit these hashes; index them so the
-- token-gated public endpoints are a single index probe.
CREATE INDEX newsletter_subscriber_unsub_token_idx
  ON newsletter_subscriber (unsubscribe_token_hash);
CREATE INDEX newsletter_subscriber_confirm_token_idx
  ON newsletter_subscriber (confirm_token_hash);

-- --- webhook_event (the idempotency ledger) ------------------------------
-- One row per processed provider event. The PK (provider, event_id) is the
-- dedup: a replay is an ON CONFLICT DO NOTHING no-op, performed in the SAME
-- transaction as the status mutation so a replayed event mutates nothing.
CREATE TABLE webhook_event (
  provider    text NOT NULL,
  event_id    text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, event_id)
);

-- --- Mechanism A grants (0002) ------------------------------------------
-- The 0002 `GRANT ... ON ALL TABLES` bound only the tables that existed then, so
-- these new tables need their own grant. The application role gets full DML; the
-- analytics read role is deliberately NOT granted (the default-deny stance the
-- other sensitive tables use) — the subscriber list holds contactable emails.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON newsletter_subscriber, webhook_event
  TO curiolab_app;
