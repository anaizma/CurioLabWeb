// -------------------------------------------------------------------------
// Application-level authenticated field encryption (mentor-student DM Phase 1,
// design C.11 — the encryption-at-rest seam). AES-256-GCM over node:crypto with
// a fresh 96-bit IV per record, the auth tag stored + verified on decrypt, and a
// version byte for future key rotation. The 256-bit key is read from the
// ENVIRONMENT (DM_ENCRYPTION_KEY, base64) at USE time — never hardcoded, never
// read from a .env file, never logged. A missing/malformed key fails loudly.
//
// These tests inject a known test key via env and prove: round-trip, tamper
// detection (a flipped ciphertext or tag byte fails decryption), unique IVs
// across encryptions of the same plaintext, and a missing key throws.
// -------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { randomBytes } from 'node:crypto'
import { decryptField, encryptField } from '../src/field-crypto.js'

const ENV_KEY = 'DM_ENCRYPTION_KEY'
// A KNOWN, obviously-synthetic 32-byte test key (base64). Never a production key.
const TEST_KEY_B64 = randomBytes(32).toString('base64')

let saved: string | undefined
beforeEach(() => {
  saved = process.env[ENV_KEY]
  process.env[ENV_KEY] = TEST_KEY_B64
})
afterEach(() => {
  if (saved === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = saved
})

describe('field-crypto (AES-256-GCM authenticated field encryption)', () => {
  test('round-trips plaintext through encrypt then decrypt', () => {
    const plaintext = 'Running late — see you at 4. (synthetic)'
    const record = encryptField(plaintext)
    expect(record.v).toBe(1)
    expect(typeof record.iv).toBe('string')
    expect(typeof record.ct).toBe('string')
    expect(typeof record.tag).toBe('string')
    // The ciphertext at rest is NOT the plaintext.
    expect(record.ct).not.toContain('Running late')
    expect(decryptField(record)).toBe(plaintext)
  })

  test('a fresh 96-bit IV is used per record (same plaintext -> distinct iv + ct)', () => {
    const plaintext = 'identical message body'
    const a = encryptField(plaintext)
    const b = encryptField(plaintext)
    // 96-bit IV = 12 bytes = 16 base64 chars.
    expect(Buffer.from(a.iv, 'base64').length).toBe(12)
    expect(a.iv).not.toBe(b.iv)
    expect(a.ct).not.toBe(b.ct)
    // Both still decrypt to the same plaintext.
    expect(decryptField(a)).toBe(plaintext)
    expect(decryptField(b)).toBe(plaintext)
  })

  test('a flipped ciphertext byte fails decryption (tamper detection)', () => {
    const record = encryptField('do not tamper with this')
    const ctBytes = Buffer.from(record.ct, 'base64')
    ctBytes[0] = ctBytes[0]! ^ 0xff
    const tampered = { ...record, ct: ctBytes.toString('base64') }
    expect(() => decryptField(tampered)).toThrow()
  })

  test('a flipped auth-tag byte fails decryption (tamper detection)', () => {
    const record = encryptField('authenticated payload')
    const tagBytes = Buffer.from(record.tag, 'base64')
    tagBytes[0] = tagBytes[0]! ^ 0xff
    const tampered = { ...record, tag: tagBytes.toString('base64') }
    expect(() => decryptField(tampered)).toThrow()
  })

  test('encrypting with no key present throws (never silently stores plaintext)', () => {
    delete process.env[ENV_KEY]
    expect(() => encryptField('secret')).toThrow(/DM_ENCRYPTION_KEY/)
  })

  test('a wrong-length key throws (a 256-bit key is required)', () => {
    process.env[ENV_KEY] = randomBytes(16).toString('base64') // 128-bit, too short
    expect(() => encryptField('secret')).toThrow(/256-bit|32 bytes/i)
  })

  test('decrypting with a different key fails (authentication over the key)', () => {
    const record = encryptField('cross-key payload')
    process.env[ENV_KEY] = randomBytes(32).toString('base64') // rotate to a different key
    expect(() => decryptField(record)).toThrow()
  })
})
