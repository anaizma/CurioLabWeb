// -------------------------------------------------------------------------
// The shared password policy. Pure, so this is the only place it needs testing:
// the service (CredentialTokenService), the HTTP surface and the form all call
// these exact functions.
// -------------------------------------------------------------------------

import { describe, expect, test } from 'vitest'
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_HINTS,
  passwordMeetsPolicy,
  passwordPolicyProblems,
} from '../src/password-policy.js'

describe('length', () => {
  test('refuses anything shorter than the minimum', () => {
    expect(passwordMeetsPolicy('Sh0rt!')).toBe(false)
    expect(passwordPolicyProblems('Sh0rt!')[0]).toContain(String(PASSWORD_MIN_LENGTH))
  })

  test('accepts exactly the minimum', () => {
    const at = 'Abcdefgh1234'.slice(0, PASSWORD_MIN_LENGTH)
    expect(at.length).toBe(PASSWORD_MIN_LENGTH)
    expect(passwordMeetsPolicy(at)).toBe(true)
  })

  test('refuses an absurdly long input (a cheap way to make argon2id work hard)', () => {
    expect(passwordMeetsPolicy(`aB${'x'.repeat(PASSWORD_MAX_LENGTH)}`)).toBe(false)
  })
})

describe('character classes', () => {
  test('refuses a single class even when it is long', () => {
    expect(passwordMeetsPolicy('abcdefghijklmnop')).toBe(false)
  })

  test('two classes is enough — four is not demanded', () => {
    // Demanding all four reliably produces "Password1!" and drives reuse, so the
    // policy deliberately stops at two.
    expect(passwordMeetsPolicy('correcthorseB')).toBe(true)
    expect(passwordMeetsPolicy('correcthorse42')).toBe(true)
    expect(passwordMeetsPolicy('correct-horse-battery')).toBe(true)
  })
})

describe('trivially weak inputs', () => {
  test('refuses one repeated character however long', () => {
    expect(passwordMeetsPolicy('aaaaaaaaaaaaaaaaaaaa')).toBe(false)
  })

  test('refuses the passwords a stuffing list opens with', () => {
    expect(passwordMeetsPolicy('password123')).toBe(false)
    expect(passwordMeetsPolicy('Password123')).toBe(false) // case-insensitive
    expect(passwordMeetsPolicy('  qwerty123456  ')).toBe(false) // trimmed
  })
})

describe('reporting', () => {
  test('returns EVERY unmet rule, not just the first', () => {
    // A form that reveals one rule at a time turns one decision into four
    // round trips.
    const problems = passwordPolicyProblems('aaa')
    expect(problems.length).toBeGreaterThan(1)
  })

  test('an acceptable password has no problems', () => {
    expect(passwordPolicyProblems('a-quiet-Tuesday-in-March')).toEqual([])
  })

  test('the hints shown before typing describe the rules that are enforced', () => {
    expect(PASSWORD_POLICY_HINTS.length).toBeGreaterThan(0)
    expect(PASSWORD_POLICY_HINTS[0]).toContain(String(PASSWORD_MIN_LENGTH))
  })
})
