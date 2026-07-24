// -------------------------------------------------------------------------
// §10 — the privileged-role set that mandates two-factor auth.
//
// The login gate requires a second factor for any account whose memberships
// include a privileged role. "Privileged" is every staff/teaching/platform role
// — everything EXCEPT the two youth-side roles (student, alumni). Guardians
// carry no membership role at all, so they are unaffected too. This set is
// declared once in core (beside ALL_ROLES / the registry) so the http login
// gate and any meta-test read the same source of truth.
// -------------------------------------------------------------------------

import { describe, expect, test } from 'vitest'
import { ALL_ROLES, PRIVILEGED_ROLES, requiresTwoFactor, type Role } from '../src/index.js'

describe('PRIVILEGED_ROLES', () => {
  test('covers the work order roles (admin/platform_admin, director, mentor/instructor)', () => {
    for (const r of [
      'platform_admin',
      'chapter_director',
      'junior_mentor',
      'senior_instructor',
      'lead_instructor',
    ] as Role[]) {
      expect(PRIVILEGED_ROLES).toContain(r)
    }
  })

  test('excludes exactly student and alumni (the youth-side, password-only roles)', () => {
    expect(PRIVILEGED_ROLES).not.toContain('student')
    expect(PRIVILEGED_ROLES).not.toContain('alumni')
    const nonPrivileged = ALL_ROLES.filter((r) => !PRIVILEGED_ROLES.includes(r))
    expect([...nonPrivileged].sort()).toEqual(['alumni', 'student'])
  })

  test('platform_staff and comms_associate are privileged (cross-chapter / staff authority)', () => {
    expect(PRIVILEGED_ROLES).toContain('platform_staff')
    expect(PRIVILEGED_ROLES).toContain('comms_associate')
  })
})

describe('requiresTwoFactor', () => {
  test('true when any membership role is privileged', () => {
    expect(requiresTwoFactor(['chapter_director'])).toBe(true)
    expect(requiresTwoFactor(['student', 'junior_mentor'])).toBe(true)
  })

  test('false for a student / alumni / no-membership (guardian) account', () => {
    expect(requiresTwoFactor(['student'])).toBe(false)
    expect(requiresTwoFactor(['alumni'])).toBe(false)
    expect(requiresTwoFactor([])).toBe(false)
  })
})
