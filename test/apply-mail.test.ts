import { afterEach, describe, expect, test } from 'vitest'
import { buildDirectorLeadNotification, directorNotifyRecipient } from '../lib/emails/apply-mail'

describe('buildDirectorLeadNotification', () => {
  test('includes the lead email, chapter, filler role, source, and a portal link', () => {
    const email = buildDirectorLeadNotification({
      leadEmail: 'parent@example.test',
      chapter: 'cwru',
      fillerRole: 'parent',
      source: 'A friend told me',
      appUrl: 'https://curiolab.test',
    })
    expect(email.subject).toContain('parent@example.test')
    for (const body of [email.text, email.html]) {
      expect(body).toContain('parent@example.test')
      expect(body).toContain('cwru')
      expect(body).toContain('parent')
      expect(body).toContain('A friend told me')
      expect(body).toContain('https://curiolab.test/portal/director/applications')
    }
  })

  test('renders a dash for a missing source and never uses an em dash', () => {
    const email = buildDirectorLeadNotification({
      leadEmail: 'p@example.test',
      chapter: 'another-school',
      fillerRole: 'student',
      source: null,
      appUrl: 'https://curiolab.test',
    })
    expect(email.text).toContain('student')
    expect(`${email.subject}${email.text}${email.html}`).not.toContain('—') // no em dash (Emily's preference)
  })

  test('escapes HTML-significant characters from untrusted fields in the html body', () => {
    const email = buildDirectorLeadNotification({
      leadEmail: '<b>x</b>@e.test',
      chapter: 'a&b',
      fillerRole: 'parent',
      source: '<script>alert(1)</script>',
      appUrl: 'https://curiolab.test',
    })
    expect(email.html).not.toContain('<script>')
    expect(email.html).toContain('&lt;script&gt;')
    expect(email.html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(email.html).toContain('a&amp;b')
  })
})

describe('directorNotifyRecipient', () => {
  const original = process.env.DIRECTOR_NOTIFY_EMAIL
  afterEach(() => {
    if (original === undefined) delete process.env.DIRECTOR_NOTIFY_EMAIL
    else process.env.DIRECTOR_NOTIFY_EMAIL = original
  })

  test('defaults to the director address when DIRECTOR_NOTIFY_EMAIL is unset', () => {
    delete process.env.DIRECTOR_NOTIFY_EMAIL
    expect(directorNotifyRecipient()).toBe('esong@acuriolab.org')
  })

  test('uses DIRECTOR_NOTIFY_EMAIL when set', () => {
    process.env.DIRECTOR_NOTIFY_EMAIL = 'ops@example.test'
    expect(directorNotifyRecipient()).toBe('ops@example.test')
  })
})
