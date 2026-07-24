// -------------------------------------------------------------------------
// RFC 6238 TOTP / RFC 4226 HOTP — dependency-free, over Node's crypto.
//
// 01-stack.md keeps the crypto surface small and audited. There is no otplib /
// @noble dependency in the tree, and the work order says NOT to add one for a
// primitive this small: TOTP is HMAC-SHA1 over a big-endian time-step counter
// plus the standard dynamic-truncation, which is a few lines over node:crypto.
// This module is a PEER of password.ts (argon2id) and tokens.ts (session
// tokens) — the account-crypto layer the app service and the login controller
// build on.
//
// AT-REST NOTE: a TOTP shared secret, unlike a password or a session token,
// must be RECOVERABLE to verify a code, so it cannot be hashed. The codebase has
// no encryption-at-rest seam today (tokens are SHA-256 hashed, passwords are
// argon2id — both one-way), so the secret is stored as its base32 string in
// account.totp_secret. The at-rest expectation is documented in the §10 runbook
// (docs/platform/api-reference.md): the account table is the trust boundary;
// column-level encryption is a future seam to add here (encrypt on write /
// decrypt on read) without touching callers.
// -------------------------------------------------------------------------

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const RFC4648_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Encode bytes as unpadded, uppercase RFC 4648 base32 (the authenticator form). */
export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += RFC4648_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += RFC4648_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

/** Decode RFC 4648 base32, tolerant of lowercase, whitespace, and `=` padding. */
export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=]/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = RFC4648_ALPHABET.indexOf(ch)
    if (idx === -1) throw new Error(`invalid base32 character: ${ch}`)
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** Default TOTP parameters (RFC 6238): SHA1, 30-second step, 6 digits, T0 = 0. */
export const TOTP_STEP_SECONDS = 30
export const TOTP_DIGITS = 6

/** RFC 4226 HOTP: an HMAC-SHA1 over the big-endian 8-byte counter, truncated. */
export function hotp(key: Buffer, counter: number, digits: number = TOTP_DIGITS): string {
  const buf = Buffer.alloc(8)
  buf.writeBigInt64BE(BigInt(counter))
  const digest = createHmac('sha1', key).update(buf).digest()
  const offset = digest[digest.length - 1]! & 0x0f
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff)
  return (binary % 10 ** digits).toString().padStart(digits, '0')
}

export interface TotpOptions {
  step?: number
  digits?: number
  /** The T0 epoch offset in seconds (RFC 6238 default 0). */
  t0?: number
}

/** The RFC 6238 time-step counter for an epoch-ms instant. */
function counterAt(atMs: number, step: number, t0: number): number {
  return Math.floor((Math.floor(atMs / 1000) - t0) / step)
}

/** The TOTP code for a base32 secret at `atMs` (epoch milliseconds). */
export function totp(secretBase32: string, atMs: number, opts: TotpOptions = {}): string {
  const step = opts.step ?? TOTP_STEP_SECONDS
  const digits = opts.digits ?? TOTP_DIGITS
  const t0 = opts.t0 ?? 0
  return hotp(base32Decode(secretBase32), counterAt(atMs, step, t0), digits)
}

export interface VerifyTotpOptions extends TotpOptions {
  /** How many steps either side of `atMs` are accepted (RFC 6238 §5.2). */
  window?: number
}

/**
 * Verify `code` against the secret at `atMs`, allowing +/- `window` steps
 * (default 1). Returns the MATCHED time-step counter (so the caller can record
 * it as the last-used step and reject a replay within the same step), or null.
 * The per-candidate compare is timing-safe.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  atMs: number,
  opts: VerifyTotpOptions = {},
): number | null {
  const step = opts.step ?? TOTP_STEP_SECONDS
  const digits = opts.digits ?? TOTP_DIGITS
  const t0 = opts.t0 ?? 0
  const window = opts.window ?? 1
  const key = base32Decode(secretBase32)
  const center = counterAt(atMs, step, t0)
  const candidate = code.trim()
  let matched: number | null = null
  for (let d = -window; d <= window; d++) {
    const counter = center + d
    const expected = hotp(key, counter, digits)
    // Constant-time compare; both operands are fixed-width digit strings.
    if (
      candidate.length === expected.length &&
      timingSafeEqual(Buffer.from(candidate), Buffer.from(expected))
    ) {
      matched = counter
    }
  }
  return matched
}

/** A fresh base32 TOTP secret with `byteLength` bytes of CSPRNG entropy (default 20 = 160 bits, the SHA1 block-adjacent standard). */
export function generateTotpSecret(byteLength = 20): string {
  return base32Encode(randomBytes(byteLength))
}

export interface ProvisioningUriInput {
  secret: string
  /** The account label shown in the authenticator (e.g. the login email). */
  accountName: string
  /** The issuer shown in the authenticator (the product name). */
  issuer: string
  digits?: number
  period?: number
}

/**
 * The otpauth:// provisioning URI (Key Uri Format) the frontend renders as a QR
 * code. We emit the URI only — NO QR image is generated server-side.
 */
export function totpProvisioningUri(input: ProvisioningUriInput): string {
  const issuer = encodeURIComponent(input.issuer)
  const label = `${issuer}:${encodeURIComponent(input.accountName)}`
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(input.digits ?? TOTP_DIGITS),
    period: String(input.period ?? TOTP_STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

/**
 * A set of one-time recovery codes shown to the operator ONCE. Each is 50 bits
 * of CSPRNG entropy rendered as `xxxxx-xxxxx` (lowercase base32hex-ish). The
 * caller hashes them like passwords (argon2id) before storing — this returns the
 * plaintext to display, never persists it.
 */
export function generateBackupCodes(count = 10): string[] {
  const codes = new Set<string>()
  while (codes.size < count) {
    const raw = base32Encode(randomBytes(7)).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10)
    if (raw.length === 10) codes.add(`${raw.slice(0, 5)}-${raw.slice(5)}`)
  }
  return [...codes]
}
