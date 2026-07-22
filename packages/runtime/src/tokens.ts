// -------------------------------------------------------------------------
// Opaque session tokens (01-stack.md; 02-data-model.md `session`).
//
// The token handed to the client is high-entropy CSPRNG output. Only its hash
// is stored as session.token_hash; the plaintext never touches the database and
// is never logged. Because the token is already uniformly random 256-bit, a
// single fast SHA-256 is the correct index-lookup transform (this is the Lucia
// reference pattern) — argon2 is for low-entropy human passwords, not tokens.
// -------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto'

/** A fresh opaque session token: 256 bits of CSPRNG entropy, URL-safe. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

/** The stored form of a token: its SHA-256 hex digest. Deterministic. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
