// -------------------------------------------------------------------------
// The account-security email copy (lib/emails/auth-mail.ts) and the internal
// self-call origin (lib/internal-origin.ts).
//
// The mail builders are pure, so the properties worth asserting are the ones a
// mistake would quietly break: the link is the one we were handed (never rebuilt
// from an env var), the secret appears exactly once and only inside that link,
// and the honesty rules hold (no invented location, no invented device).
// -------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  buildNewSignInEmail,
  buildPasswordChangedEmail,
  buildPasswordResetEmail,
  expiryPhrase,
} from '@/lib/emails/auth-mail'
import { internalOrigin } from '@/lib/internal-origin'

describe('the reset email', () => {
  const NOW = new Date('2026-07-27T12:00:00Z')
  const EXPIRES = new Date('2026-07-27T13:00:00Z')
  const URL = 'https://acuriolab.org/reset-password/tok_abc123'

  test('uses the link it was handed, in both parts', () => {
    const mail = buildPasswordResetEmail(URL, EXPIRES, NOW)
    expect(mail.text).toContain(URL)
    expect(mail.html).toContain(`href="${URL}"`)
  })

  test('the token appears ONLY inside the link', () => {
    const mail = buildPasswordResetEmail(URL, EXPIRES, NOW)
    // One occurrence per part: a token repeated in a subject line or a footer is
    // a token in a preview pane and a notification banner.
    expect(mail.text.split('tok_abc123')).toHaveLength(2)
    expect(mail.html.split('tok_abc123')).toHaveLength(2)
    expect(mail.subject).not.toContain('tok_abc123')
  })

  test('says how long the link lasts', () => {
    const mail = buildPasswordResetEmail(URL, EXPIRES, NOW)
    expect(mail.text).toContain('about 1 hour')
  })

  test('tells an unrequested recipient that ignoring it is safe', () => {
    // The most common recipient of a reset email is someone who did not ask.
    const mail = buildPasswordResetEmail(URL, EXPIRES, NOW)
    expect(mail.text.toLowerCase()).toContain('if you did not ask')
    expect(mail.text.toLowerCase()).toContain('has not')
  })
})

describe('the password-changed notice', () => {
  test('is the thing that makes an unauthorized reset visible', () => {
    const mail = buildPasswordChangedEmail(new Date('2026-07-27T12:00:00Z'), 'https://acuriolab.org/forgot-password')
    expect(mail.subject.toLowerCase()).toContain('password was changed')
    expect(mail.text.toLowerCase()).toContain('if this was not you')
    // It must say the useful thing: regaining the mailbox is enough.
    expect(mail.text.toLowerCase()).toContain('signed out')
  })
})

describe('the new-sign-in notice', () => {
  const BASE = {
    at: new Date('2026-07-27T12:00:00Z'),
    revokeUrl: 'https://acuriolab.org/sessions/revoke/rvk_xyz789',
  }

  test('reports the coarse device and network it was given', () => {
    const mail = buildNewSignInEmail({ ...BASE, deviceLabel: 'Chrome on Windows', ipHint: '203.0.113.0/24' })
    expect(mail.text).toContain('Chrome on Windows')
    expect(mail.text).toContain('203.0.113.0/24')
  })

  test('is honest that it is a network, not a location', () => {
    // A confident-sounding city we cannot stand behind is worse than a prefix.
    const mail = buildNewSignInEmail({ ...BASE, deviceLabel: 'Chrome on Windows', ipHint: '203.0.113.0/24' })
    expect(mail.text.toLowerCase()).toContain('not a precise location')
  })

  test('says "unrecognised" rather than inventing a device', () => {
    const mail = buildNewSignInEmail({ ...BASE, deviceLabel: null, ipHint: null })
    expect(mail.text).toContain('Unrecognised device')
    expect(mail.text).toContain('Unknown network')
  })

  test('carries the revoke link, and the revoke token appears only there', () => {
    const mail = buildNewSignInEmail({ ...BASE, deviceLabel: 'Chrome on Windows', ipHint: '203.0.113.0/24' })
    expect(mail.text).toContain(BASE.revokeUrl)
    expect(mail.html).toContain(`href="${BASE.revokeUrl}"`)
    expect(mail.text.split('rvk_xyz789')).toHaveLength(2)
    expect(mail.subject).not.toContain('rvk_xyz789')
  })

  test('tells a privileged holder that their second factor was also used', () => {
    const mail = buildNewSignInEmail({ ...BASE, deviceLabel: 'Chrome on Windows', ipHint: '203.0.113.0/24' })
    expect(mail.text.toLowerCase()).toContain('authenticator app')
  })
})

describe('expiryPhrase', () => {
  const NOW = new Date('2026-07-27T12:00:00Z')
  test('says minutes for a short window and hours for a long one', () => {
    expect(expiryPhrase(new Date('2026-07-27T12:15:00Z'), NOW)).toBe('about 15 minutes')
    expect(expiryPhrase(new Date('2026-07-27T13:00:00Z'), NOW)).toBe('about 1 hour')
    expect(expiryPhrase(new Date('2026-07-27T15:00:00Z'), NOW)).toBe('about 3 hours')
  })

  test('never says zero or a negative for an already-stale token', () => {
    expect(expiryPhrase(new Date('2026-07-27T11:00:00Z'), NOW)).toBe('about 1 minute')
  })
})

describe('internalOrigin', () => {
  const saved = { app: process.env.APP_URL, site: process.env.NEXT_PUBLIC_SITE_URL, port: process.env.PORT }

  beforeEach(() => {
    delete process.env.APP_URL
    delete process.env.NEXT_PUBLIC_SITE_URL
  })
  afterEach(() => {
    if (saved.app === undefined) delete process.env.APP_URL
    else process.env.APP_URL = saved.app
    if (saved.site === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
    else process.env.NEXT_PUBLIC_SITE_URL = saved.site
    if (saved.port === undefined) delete process.env.PORT
    else process.env.PORT = saved.port
  })

  test('prefers the explicit deployment override', () => {
    process.env.APP_URL = 'https://acuriolab.org/'
    expect(internalOrigin('evil.example')).toBe('https://acuriolab.org')
  })

  test('REFUSES a non-loopback Host header', () => {
    // These self-calls forward the caller's session cookie, so a Host-derived
    // origin would be a session-token exfiltration primitive.
    process.env.PORT = '3000'
    expect(internalOrigin('evil.example')).toBe('http://127.0.0.1:3000')
    expect(internalOrigin('acuriolab.org.evil.example')).toBe('http://127.0.0.1:3000')
  })

  test('accepts a loopback Host, which is what keeps local dev working', () => {
    expect(internalOrigin('localhost:3000')).toBe('http://localhost:3000')
    expect(internalOrigin('127.0.0.1:3001')).toBe('http://127.0.0.1:3001')
  })

  test('falls back to loopback when there is no Host at all', () => {
    process.env.PORT = '8080'
    expect(internalOrigin(null)).toBe('http://127.0.0.1:8080')
  })
})
