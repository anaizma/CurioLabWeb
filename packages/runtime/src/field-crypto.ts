// -------------------------------------------------------------------------
// Application-level authenticated field encryption (mentor-student DM design
// C.11: the encryption-at-rest seam). A small, GENERIC seam over node:crypto:
// AES-256-GCM with a fresh random 96-bit IV per record, the authentication tag
// stored and verified on decrypt, and a version byte for future key rotation.
//
// The 256-bit key is read from the ENVIRONMENT (`DM_ENCRYPTION_KEY`, base64) at
// USE time. It is NEVER hardcoded, NEVER read from a `.env` file here, and NEVER
// logged; neither is any plaintext. If the key is absent or malformed, encrypt
// and decrypt FAIL LOUDLY (throw) rather than silently storing/returning
// plaintext — a missing key must never degrade to no encryption.
//
// This seam is intentionally general. Phase 1 uses it for `dm_message.body`; a
// follow-up will also use it to wrap the TOTP secret (packages/runtime/totp.ts),
// closing the at-rest gap noted there. TOTP is deliberately NOT refactored now.
// -------------------------------------------------------------------------

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/** The current field-crypto envelope version. Bump on a key-derivation change. */
export const FIELD_CRYPTO_VERSION = 1

/** The env var holding the base64-encoded 256-bit key, read at use time. */
export const DM_ENCRYPTION_KEY_ENV = 'DM_ENCRYPTION_KEY'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12 // 96-bit IV, the GCM standard
const KEY_BYTES = 32 // 256-bit key
const TAG_BYTES = 16

/**
 * One encrypted field at rest. `v` is the envelope version, `iv` the per-record
 * random 96-bit nonce, `ct` the ciphertext, `tag` the GCM authentication tag —
 * all base64. Stored as a JSON blob (or discrete columns) beside the record.
 */
export interface EncryptedField {
  v: number
  iv: string
  ct: string
  tag: string
}

/**
 * Load the 256-bit key from the environment. Throws (never returns a default) if
 * the var is absent, empty, or not exactly 32 bytes once base64-decoded — so a
 * misconfiguration fails loudly instead of silently weakening encryption. The key
 * bytes are never logged.
 */
function loadKey(): Buffer {
  const b64 = process.env[DM_ENCRYPTION_KEY_ENV]
  if (b64 == null || b64.length === 0) {
    throw new Error(
      `field encryption requires ${DM_ENCRYPTION_KEY_ENV} (base64 256-bit key) in the environment`,
    )
  }
  let key: Buffer
  try {
    key = Buffer.from(b64, 'base64')
  } catch {
    throw new Error(`${DM_ENCRYPTION_KEY_ENV} is not valid base64`)
  }
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `${DM_ENCRYPTION_KEY_ENV} must decode to a 256-bit key (32 bytes); got ${key.length} bytes`,
    )
  }
  return key
}

/**
 * Encrypt `plaintext` under the environment key with a fresh random 96-bit IV.
 * Returns the versioned {v, iv, ct, tag} envelope. Throws if the key is
 * missing/malformed (never silently returns plaintext).
 */
export function encryptField(plaintext: string): EncryptedField {
  const key = loadKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    v: FIELD_CRYPTO_VERSION,
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: tag.toString('base64'),
  }
}

/**
 * Decrypt an {v, iv, ct, tag} envelope under the environment key, VERIFYING the
 * authentication tag. Any tampering (a flipped ciphertext or tag byte) or a key
 * mismatch throws — the caller must treat a throw as "unreadable", never as
 * empty. Throws if the key is missing/malformed or the version is unsupported.
 */
export function decryptField(record: EncryptedField): string {
  if (record.v !== FIELD_CRYPTO_VERSION) {
    throw new Error(`unsupported field-crypto version: ${record.v}`)
  }
  const key = loadKey()
  const iv = Buffer.from(record.iv, 'base64')
  const ct = Buffer.from(record.ct, 'base64')
  const tag = Buffer.from(record.tag, 'base64')
  if (tag.length !== TAG_BYTES) throw new Error('field-crypto: malformed authentication tag')
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}
