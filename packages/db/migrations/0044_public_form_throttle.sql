-- 0044_public_form_throttle.sql — the per-email / per-IP throttle behind the
-- PUBLIC, unauthenticated form endpoints (POST /api/apply first).
--
-- Those endpoints send transactional mail on every accepted call (the applicant's
-- continue link plus the director's "new lead" alert), so an unthrottled endpoint
-- lets anyone mail-bomb the director, burn the Resend quota, and damage the
-- sending domain's reputation. Cloudflare Turnstile is the first line; this table
-- is the second, and unlike Turnstile it holds even if the widget is bypassed.
--
-- One row per accepted attempt. The route counts rows in a rolling window before
-- accepting the next one, so the limit is evaluated at REQUEST time against real
-- history (the same decision-time pattern as invite rate limiting) rather than in
-- process memory, which would not survive a restart or a second instance.
--
-- `bucket` is the identity the limit applies to (an email address or a client IP)
-- and `scope` names which limit it belongs to, so one table serves every public
-- form without a migration per form.

CREATE TABLE public_form_attempt (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The form being throttled, e.g. 'apply'. Namespaces the buckets.
  scope       text        NOT NULL,
  -- What the limit is keyed on: 'email' or 'ip'.
  bucket_kind text        NOT NULL,
  -- The email address (lowercased) or client IP. Never a shared placeholder: an
  -- unresolvable IP is simply not recorded, so unknown callers are not bucketed
  -- together into one shared limit.
  bucket      text        NOT NULL,
  at          timestamptz NOT NULL DEFAULT now()
);

-- The only read pattern: count recent attempts for one bucket in one scope.
CREATE INDEX public_form_attempt_lookup
  ON public_form_attempt (scope, bucket_kind, bucket, at DESC);

-- Supports the retention sweep that discards rows older than any live window.
CREATE INDEX public_form_attempt_at ON public_form_attempt (at);

COMMENT ON TABLE public_form_attempt IS
  'Decision-time rate-limit ledger for public unauthenticated forms. Rows are '
  'counted in a rolling window; anything older than the longest window is '
  'disposable and may be swept.';
