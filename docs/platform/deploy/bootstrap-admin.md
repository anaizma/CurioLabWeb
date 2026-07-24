# Runbook — bootstrap the first platform admin (§2)

The very first `platform_admin` is the one legitimate account with **no inviter**
(every other account originates from an invite tied to a roster entry). This
runbook creates it. The seed is **idempotent and guarded**: once any
`platform_admin` exists, re-running is a no-op that reports the existing admin and
exits non-zero — it will never create a second admin.

## What it does

1. Refuses if any `platform_admin` membership already exists (guard).
2. Creates (or reuses) a `platform` home chapter and, in one transaction, the
   admin `account` (status `active`, `self_managed`, credential owner
   `self_private`) with an **argon2id-hashed** password and a `platform_admin`
   membership.
3. Enrolls **and activates** TOTP, and prints the **secret**, the
   `otpauth://` provisioning URI, and the **one-time backup codes** — once.

The password is read from an environment variable, is **never logged**, and the
root `.env` is **never read** by the seed.

## Run it

```bash
export DATABASE_URL='postgres://…'            # the target database
export CURIOLAB_BOOTSTRAP_EMAIL='founder@acuriolab.org'
export CURIOLAB_BOOTSTRAP_NAME='Ada Founder'
export CURIOLAB_BOOTSTRAP_PASSWORD='…'         # set by the operator; never committed/logged
# optional: export CURIOLAB_BOOTSTRAP_DOB='1970-01-01'

npm run seed:admin --workspace @curiolab/app
```

(Under the hood: `tsx packages/app/scripts/bootstrap-admin.ts`, which calls the
tested `bootstrapPlatformAdmin(sql, …)` in `@curiolab/app`.)

## After running

- **Record the TOTP secret / URI and backup codes immediately** — they are shown
  once and never re-retrievable (the backup codes are stored only as argon2id
  hashes; the secret is stored to verify codes).
- Add the secret to an authenticator app (or scan the `otpauth://` URI as a QR).
- **First login is two-step** (this admin is privileged): `POST /api/auth/login`
  with the email + password returns `{ totpRequired: true, pendingToken }` (no
  session); then `POST /api/auth/totp` with the `pendingToken` + the current
  6-digit code mints the session. A backup code works in place of the code.

## Re-running / safety

A second invocation prints the existing admin id, creates nothing, and exits
non-zero. There is no supported "reset" here — recovering a locked-out admin is a
deliberate, separate operation.

## Secret-at-rest note (§10)

A TOTP secret must be **recoverable** to verify a code, so unlike passwords
(argon2id) and every `*_token` (SHA-256) it **cannot be hashed** — it is stored as
its base32 string in `account.totp_secret`. The account table is the trust
boundary today; column-level encryption (encrypt-on-write / decrypt-on-read) is a
future seam to add in `packages/runtime/src/totp.ts` without touching callers.
