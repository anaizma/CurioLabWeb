// -------------------------------------------------------------------------
// RFC 6238 TOTP / RFC 4226 HOTP primitive (packages/runtime/src/totp.ts).
//
// A dependency-free implementation over Node's crypto HMAC-SHA1 (no otplib / no
// @noble). These tests pin it to the published RFC test vectors so the codes we
// generate interoperate with any standard authenticator app, and exercise the
// verification window, timing-safe compare, base32 round-trip, provisioning URI,
// and backup-code generation. No database — pure crypto.
// -------------------------------------------------------------------------

import { describe, expect, test } from 'vitest'
import {
  base32Encode,
  base32Decode,
  hotp,
  totp,
  verifyTotp,
  generateTotpSecret,
  totpProvisioningUri,
  generateBackupCodes,
} from '../src/totp.js'

// The RFC 4226 / RFC 6238 shared secret: the ASCII string "12345678901234567890".
const RFC_SECRET_ASCII = Buffer.from('12345678901234567890', 'ascii')
const RFC_SECRET_B32 = base32Encode(RFC_SECRET_ASCII)

describe('base32 (RFC 4648)', () => {
  test('round-trips arbitrary bytes', () => {
    const bytes = Buffer.from([0x00, 0x0f, 0x10, 0xff, 0x42, 0x99, 0x7a])
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true)
  })

  test('decode tolerates lowercase, spaces, and padding', () => {
    const enc = base32Encode(RFC_SECRET_ASCII)
    const messy = enc.toLowerCase().replace(/(.{4})/g, '$1 ')
    expect(base32Decode(messy).equals(RFC_SECRET_ASCII)).toBe(true)
  })
})

describe('hotp — RFC 4226 Appendix D test vectors', () => {
  const expected = [
    '755224', '287082', '359152', '969429', '338314',
    '254676', '287922', '162583', '399871', '520489',
  ]
  for (let counter = 0; counter < expected.length; counter++) {
    test(`counter ${counter} -> ${expected[counter]}`, () => {
      expect(hotp(RFC_SECRET_ASCII, counter)).toBe(expected[counter])
    })
  }
})

describe('totp — RFC 6238 test vectors (SHA1, step 30, 6 digits)', () => {
  // seconds -> expected 6-digit code (low 6 digits of the RFC's 8-digit SHA1 row).
  const vectors: Array<[number, string]> = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ]
  for (const [seconds, code] of vectors) {
    test(`t=${seconds}s -> ${code}`, () => {
      expect(totp(RFC_SECRET_B32, seconds * 1000)).toBe(code)
    })
  }
})

describe('verifyTotp', () => {
  test('accepts a code generated for the current step', () => {
    const secret = generateTotpSecret()
    const at = 1_700_000_000_000
    const code = totp(secret, at)
    expect(verifyTotp(secret, code, at)).not.toBeNull()
  })

  test('accepts a code from the immediately previous step (+/-1 window)', () => {
    const secret = generateTotpSecret()
    const at = 1_700_000_000_000
    const prev = totp(secret, at - 30_000)
    // Verified one step later: the previous code is still within the +/-1 window.
    const matched = verifyTotp(secret, prev, at)
    expect(matched).not.toBeNull()
  })

  test('rejects a code two steps away (outside the window)', () => {
    const secret = generateTotpSecret()
    const at = 1_700_000_000_000
    const old = totp(secret, at - 90_000) // three steps earlier
    expect(verifyTotp(secret, old, at)).toBeNull()
  })

  test('rejects a wrong code', () => {
    const secret = generateTotpSecret()
    expect(verifyTotp(secret, '000000', 1_700_000_000_000)).toBeNull()
  })

  test('returns the matched time-step counter (for the replay guard)', () => {
    const secret = generateTotpSecret()
    const at = 1_700_000_000_000
    const counter = Math.floor(at / 1000 / 30)
    expect(verifyTotp(secret, totp(secret, at), at)).toBe(counter)
  })
})

describe('generateTotpSecret', () => {
  test('produces a decodable base32 secret of the requested entropy', () => {
    const secret = generateTotpSecret()
    expect(secret).toMatch(/^[A-Z2-7]+$/)
    expect(base32Decode(secret).length).toBe(20)
  })

  test('is different every time', () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret())
  })
})

describe('totpProvisioningUri', () => {
  test('builds an otpauth:// URI the authenticator app can import', () => {
    const uri = totpProvisioningUri({
      secret: RFC_SECRET_B32,
      accountName: 'ada@example.org',
      issuer: 'CurioLab',
    })
    expect(uri.startsWith('otpauth://totp/')).toBe(true)
    expect(uri).toContain(`secret=${RFC_SECRET_B32}`)
    expect(uri).toContain('issuer=CurioLab')
    expect(uri).toContain('algorithm=SHA1')
    expect(uri).toContain('digits=6')
    expect(uri).toContain('period=30')
    // The label carries the issuer prefix and the URL-encoded account name.
    expect(uri).toContain('CurioLab:ada%40example.org')
  })
})

describe('generateBackupCodes', () => {
  test('returns the requested count of distinct codes', () => {
    const codes = generateBackupCodes(10)
    expect(codes).toHaveLength(10)
    expect(new Set(codes).size).toBe(10)
    for (const c of codes) expect(c).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/)
  })
})
