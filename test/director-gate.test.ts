// -------------------------------------------------------------------------
// The /portal/director access rule (lib/portal/director/gate.ts).
//
// These are the pure decisions the proxy and requireDirector() both hang off, so
// they are testable without a browser: which paths are covered, which
// memberships open the portal, and that the ?next= round trip cannot be turned
// into an open redirect.
// -------------------------------------------------------------------------

import { describe, expect, test } from 'vitest'
import {
  DIRECTOR_PORTAL_PREFIX,
  hasDirectorAccess,
  isDirectorPath,
  loginRedirect,
  safeNextPath,
} from '@/lib/portal/director/gate'

describe('isDirectorPath', () => {
  test('covers the portal root and everything under it', () => {
    expect(isDirectorPath('/portal/director')).toBe(true)
    expect(isDirectorPath('/portal/director/applications')).toBe(true)
    expect(isDirectorPath('/portal/director/applications/abc-123')).toBe(true)
    expect(isDirectorPath('/portal/director/settings/security')).toBe(true)
  })

  test('LEAVES THE OTHER PORTALS ALONE', () => {
    // Deliberate: the student and parent portals stay reachable unauthenticated
    // so they can still be exercised.
    expect(isDirectorPath('/portal/student')).toBe(false)
    expect(isDirectorPath('/portal/parent')).toBe(false)
    expect(isDirectorPath('/portal/parent/consent')).toBe(false)
    expect(isDirectorPath('/')).toBe(false)
    expect(isDirectorPath('/login')).toBe(false)
  })

  test('does not match a path that merely starts with the same characters', () => {
    expect(isDirectorPath('/portal/directory')).toBe(false)
    expect(isDirectorPath('/portal/director-notes')).toBe(false)
  })
})

describe('hasDirectorAccess', () => {
  test('an active chapter_director or platform_admin opens the portal', () => {
    expect(hasDirectorAccess([{ role: 'chapter_director', status: 'active' }])).toBe(true)
    expect(hasDirectorAccess([{ role: 'platform_admin', status: 'active' }])).toBe(true)
  })

  test('an INACTIVE director does not', () => {
    // Load-bearing: a suspended or lapsed director keeps the membership row.
    expect(hasDirectorAccess([{ role: 'chapter_director', status: 'suspended' }])).toBe(false)
    expect(hasDirectorAccess([{ role: 'chapter_director', status: 'lapsed' }])).toBe(false)
    expect(hasDirectorAccess([{ role: 'chapter_director', status: 'pending' }])).toBe(false)
  })

  test('other roles do not, however privileged', () => {
    // The portal shows every applicant in the chapter. Needing 2FA is not the
    // same as being allowed to read that.
    expect(hasDirectorAccess([{ role: 'student', status: 'active' }])).toBe(false)
    expect(hasDirectorAccess([{ role: 'junior_mentor', status: 'active' }])).toBe(false)
    expect(hasDirectorAccess([{ role: 'lead_instructor', status: 'active' }])).toBe(false)
    expect(hasDirectorAccess([{ role: 'comms_associate', status: 'active' }])).toBe(false)
    expect(hasDirectorAccess([{ role: 'platform_staff', status: 'active' }])).toBe(false)
  })

  test('no memberships at all does not', () => {
    expect(hasDirectorAccess([])).toBe(false)
    expect(hasDirectorAccess(undefined)).toBe(false)
  })

  test('one qualifying membership among several is enough', () => {
    expect(
      hasDirectorAccess([
        { role: 'junior_mentor', status: 'active' },
        { role: 'chapter_director', status: 'active' },
      ]),
    ).toBe(true)
  })

  test('a malformed membership is refused, not crashed on', () => {
    expect(hasDirectorAccess([{}])).toBe(false)
    expect(hasDirectorAccess([{ status: 'active' }])).toBe(false)
    expect(hasDirectorAccess([{ role: 'chapter_director' }])).toBe(false)
  })
})

describe('safeNextPath', () => {
  test('keeps a real in-app path', () => {
    expect(safeNextPath('/portal/director/applications')).toBe('/portal/director/applications')
    expect(safeNextPath('/portal/director/applications?term=all')).toBe('/portal/director/applications?term=all')
  })

  test('refuses anything that could leave the site', () => {
    // The ?next= value round-trips through a URL an attacker can write, so this
    // is the whole defence against turning /login into an open redirect.
    expect(safeNextPath('https://evil.example/steal')).toBe(DIRECTOR_PORTAL_PREFIX)
    expect(safeNextPath('//evil.example/steal')).toBe(DIRECTOR_PORTAL_PREFIX)
    expect(safeNextPath('/\\evil.example')).toBe(DIRECTOR_PORTAL_PREFIX)
    expect(safeNextPath('/portal\\..\\evil')).toBe(DIRECTOR_PORTAL_PREFIX)
    expect(safeNextPath('javascript:alert(1)')).toBe(DIRECTOR_PORTAL_PREFIX)
  })

  test('falls back for empty input', () => {
    expect(safeNextPath(null)).toBe(DIRECTOR_PORTAL_PREFIX)
    expect(safeNextPath(undefined)).toBe(DIRECTOR_PORTAL_PREFIX)
    expect(safeNextPath('')).toBe(DIRECTOR_PORTAL_PREFIX)
  })
})

describe('loginRedirect', () => {
  test('sends them to login carrying where they asked for', () => {
    expect(loginRedirect('/portal/director/applications')).toBe(
      '/login?next=%2Fportal%2Fdirector%2Fapplications',
    )
  })

  test('sanitises before encoding, so a hostile next never survives', () => {
    expect(loginRedirect('https://evil.example')).toBe('/login?next=%2Fportal%2Fdirector')
  })
})
