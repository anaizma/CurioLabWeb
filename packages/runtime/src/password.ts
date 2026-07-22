// -------------------------------------------------------------------------
// Password hashing — argon2id via @node-rs/argon2 (prebuilt napi-rs binary,
// no node-gyp). 01-stack.md: "Password hashing: argon2id, from an audited
// library." The hash string is self-describing ($argon2id$v=...$m=...): the
// salt and parameters travel with it, so verification needs only the stored
// hash and the candidate password.
// -------------------------------------------------------------------------

import { hash, verify, type Algorithm } from '@node-rs/argon2'

// @node-rs/argon2 declares `Algorithm` as a `const enum`, whose *values* cannot
// be read across modules under isolatedModules. Argon2id === 2; we pin it by
// value (using the enum only as a type) so the choice is explicit rather than
// relying on the library default.
const ARGON2ID = 2 as Algorithm

/** Hash a plaintext password with argon2id. Returns the encoded hash string. */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, { algorithm: ARGON2ID })
}

/**
 * Verify a candidate password against a stored argon2id hash. Returns false on
 * mismatch rather than throwing, so callers branch on a boolean.
 */
export async function verifyPassword(storedHash: string, candidate: string): Promise<boolean> {
  return verify(storedHash, candidate)
}
